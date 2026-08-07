import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Upload, BookOpen, Trash2, Download, Loader2, Pin, Save, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const BACKEND = process.env.REACT_APP_BACKEND_URL;

function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${BACKEND}${url}`;
}

function fmtBytes(b) {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/**
 * Client Documents tab — file uploads AND embedded runbooks (rich text).
 */
export default function ClientDocumentsTab({ client }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadCategory, setUploadCategory] = useState("general");
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("all");
  const fileRef = useRef(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/clients/${client.id}/documents`, { headers });
      setDocs(res.data || []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (client?.id) fetchDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("title", f.name);
      fd.append("category", uploadCategory);
      await axios.post(`${API}/clients/${client.id}/documents`, fd, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      toast.success(`Uploaded ${f.name}`);
      await fetchDocs();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await axios.delete(`${API}/clients/${client.id}/documents/${doc.id}`, { headers });
      toast.success("Deleted");
      await fetchDocs();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  const openNewRunbook = () => {
    setEditingDoc({ id: null, title: "", body: "", category: "runbook", tags: [], pinned: false });
    setEditorOpen(true);
  };

  const openEditRunbook = (doc) => {
    setEditingDoc({ ...doc });
    setEditorOpen(true);
  };

  const saveRunbook = async () => {
    if (!editingDoc?.title) { toast.error("Title is required"); return; }
    try {
      await axios.post(`${API}/clients/${client.id}/runbooks`, editingDoc, { headers });
      toast.success("Runbook saved");
      setEditorOpen(false);
      setEditingDoc(null);
      await fetchDocs();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    }
  };

  const filtered = docs.filter(d => {
    if (filter === "all") return true;
    if (filter === "files") return d.kind === "file";
    if (filter === "runbooks") return d.kind === "runbook";
    return d.category === filter;
  });

  const categories = ["general", "credentials", "network", "passwords", "policy", "contract"];
  const fileCount = docs.filter((doc) => doc.kind === "file").length;
  const runbookCount = docs.filter((doc) => doc.kind === "runbook").length;

  return (
    <div className="space-y-4" data-testid="client-documents-tab">
      <div className="rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.08] via-background to-background p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10"><FileText className="h-5 w-5 text-violet-300" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Client knowledge</p><h2 className="mt-1 text-lg font-bold tracking-tight">Documents & runbooks</h2><p className="mt-1 text-sm text-muted-foreground">Keep client files, site procedures and technician notes together with a clear operational record.</p></div></div>
          <div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-200">{fileCount} files</Badge><Badge variant="outline" className="border-violet-500/25 bg-violet-500/[0.08] text-violet-200">{runbookCount} runbooks</Badge></div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border/60 bg-card/40 p-3">
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="docs-upload-btn">
          {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
          Upload File
        </Button>
        <input ref={fileRef} type="file" hidden onChange={handleFile} data-testid="docs-file-input" />
        <Select value={uploadCategory} onValueChange={setUploadCategory}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="docs-category-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={openNewRunbook} data-testid="docs-new-runbook-btn">
          <BookOpen className="w-3 h-3 mr-1 text-violet-400" />New Runbook
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {["all", "files", "runbooks"].map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              className="h-7 text-[11px] capitalize"
              onClick={() => setFilter(f)}
              data-testid={`docs-filter-${f}`}
            >
              {f} ({f === "all" ? docs.length : docs.filter(d => f === "files" ? d.kind === "file" : d.kind === "runbook").length})
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card data-testid="docs-empty">
          <CardContent className="py-10 text-center text-zinc-500 space-y-2">
            <FileText className="w-8 h-8 mx-auto opacity-30" />
            <p className="text-sm">No documents yet. Upload a file or create your first runbook.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(doc => (
            <Card key={doc.id} className={`group hover:border-violet-500/40 transition ${doc.pinned ? "border-amber-500/40 bg-amber-500/5" : ""}`} data-testid={`doc-card-${doc.id}`}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {doc.kind === "runbook" ? (
                    <BookOpen className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm truncate flex items-center gap-1.5">
                      {doc.pinned && <Pin className="w-3 h-3 text-amber-400" />}
                      {doc.title}
                    </CardTitle>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1 font-mono">
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider">{doc.category}</Badge>
                      {doc.kind === "file" && <span>{(doc.extension || "").toUpperCase()} · {fmtBytes(doc.size_bytes)}</span>}
                      {doc.updated_at && <span>· {format(new Date(doc.updated_at), "MMM d")}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {doc.kind === "runbook" && (
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEditRunbook(doc)} data-testid={`doc-edit-${doc.id}`}>
                      <BookOpen className="w-3 h-3" />
                    </Button>
                  )}
                  {doc.kind === "file" && doc.url && (
                    <a href={resolveUrl(doc.url)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-white/5" data-testid={`doc-download-${doc.id}`}>
                      <Download className="w-3 h-3 text-zinc-400" />
                    </a>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300" onClick={() => handleDelete(doc)} data-testid={`doc-delete-${doc.id}`}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardHeader>
              {doc.kind === "runbook" && doc.body && (
                <CardContent className="pt-0">
                  <div className="text-[11px] text-zinc-400 line-clamp-3 leading-snug" dangerouslySetInnerHTML={{ __html: doc.body }} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Runbook editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-3xl" data-testid="runbook-editor-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-violet-400" />
              {editingDoc?.id ? "Edit Runbook" : "New Runbook"}
            </DialogTitle>
          </DialogHeader>
          {editingDoc && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Title</label>
                <Input value={editingDoc.title} onChange={e => setEditingDoc({ ...editingDoc, title: e.target.value })} placeholder="e.g. Onboarding new employee — Acme" data-testid="runbook-title-input" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Category</label>
                  <Select value={editingDoc.category} onValueChange={(v) => setEditingDoc({ ...editingDoc, category: v })}>
                    <SelectTrigger className="h-8 text-xs" data-testid="runbook-category-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{[...categories, "runbook"].map(c => <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    variant={editingDoc.pinned ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs w-full"
                    onClick={() => setEditingDoc({ ...editingDoc, pinned: !editingDoc.pinned })}
                    data-testid="runbook-pin-toggle"
                  >
                    <Pin className={`w-3 h-3 mr-1 ${editingDoc.pinned ? "text-amber-400" : ""}`} />
                    {editingDoc.pinned ? "Pinned" : "Pin to top"}
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Body (HTML / Markdown)</label>
                <Textarea
                  rows={14}
                  value={editingDoc.body}
                  onChange={e => setEditingDoc({ ...editingDoc, body: e.target.value })}
                  placeholder="<h2>Steps</h2><ol><li>Open the admin console…</li></ol>"
                  className="font-mono text-xs"
                  data-testid="runbook-body-input"
                />
                <p className="text-[10px] text-zinc-500 mt-1">Tip: paste rich HTML — &lt;h2&gt;, &lt;ol&gt;, &lt;ul&gt;, &lt;p&gt;, &lt;code&gt; all supported.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} data-testid="runbook-cancel-btn">
              <X className="w-3 h-3 mr-1" />Cancel
            </Button>
            <Button onClick={saveRunbook} data-testid="runbook-save-btn">
              <Save className="w-3 h-3 mr-1" />Save Runbook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
