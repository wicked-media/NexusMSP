import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useParams, useNavigate, Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Search, Loader2, Pencil, Plus, RefreshCw, ChevronRight, FileText } from "lucide-react";
import { toast } from "sonner";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, breaks: true, linkify: true });

function useApi(token) {
  return useMemo(() => ({
    get: (p) => axios.get(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (p, b) => axios.post(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    del: (p) => axios.delete(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

export default function HelpCenterPage() {
  const { token, user } = useAuth();
  const api = useApi(token);
  const { slug } = useParams();
  const navigate = useNavigate();

  const [list, setList] = useState({ articles: [], by_category: {} });
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState(null);
  const [loadingActive, setLoadingActive] = useState(false);
  const [q, setQ] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const isAdmin = (user?.role || "").toLowerCase() === "admin";

  const reload = (search) => {
    setLoadingList(true);
    api.get(`/help/articles${search ? `?q=${encodeURIComponent(search)}` : ""}`)
      .then(setList)
      .catch((e) => toast.error(e.response?.data?.detail || e.message))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { reload(""); /* eslint-disable-next-line */ }, []);

  // Auto-load article from URL slug, or default to first
  useEffect(() => {
    if (!list.articles?.length) return;
    const target = slug || list.articles[0]?.slug;
    if (!target || (active && active.slug === target)) return;
    setLoadingActive(true);
    api.get(`/help/articles/${target}`)
      .then(setActive)
      .catch(() => setActive(null))
      .finally(() => setLoadingActive(false));
    // eslint-disable-next-line
  }, [slug, list.articles]);

  const open = (s) => navigate(`/help/${s}`);

  const onSearch = (e) => {
    e?.preventDefault?.();
    reload(q);
  };

  const onSave = async (draft) => {
    try {
      const saved = await api.post(`/help/articles`, draft);
      toast.success("Article saved");
      setEditorOpen(false);
      reload(q);
      navigate(`/help/${saved.slug}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const onDelete = async (s) => {
    if (!window.confirm("Delete this article?")) return;
    try {
      await api.del(`/help/articles/${s}`);
      toast.success("Deleted");
      navigate("/help");
      reload(q);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const onReseed = async () => {
    if (!window.confirm("Re-seed default articles? This will overwrite the 6 default articles.")) return;
    try {
      await api.post("/help/seed");
      toast.success("Seeded");
      reload("");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const categories = Object.entries(list.by_category || {});

  return (
    <PageShell>
      <div className="space-y-4" data-testid="help-center-page">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1 flex items-center gap-2">
              <BookOpen className="w-3 h-3" />Help Center
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">How NexusOps works</h1>
            <p className="text-sm text-muted-foreground">Searchable docs for every module, button and workflow.</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => { setEditing({ slug: "", title: "", category: "Basics", icon: "📘", summary: "", body_md: "" }); setEditorOpen(true); }}
                  data-testid="help-new-article-btn"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />New article
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  onClick={onReseed}
                  data-testid="help-reseed-btn"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />Re-seed defaults
                </Button>
              </>
            )}
          </div>
        </div>

        <form onSubmit={onSearch} className="flex items-center gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search articles, modules, slash commands…"
              className="pl-8"
              data-testid="help-search-input"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" data-testid="help-search-btn">Search</Button>
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* SIDEBAR */}
          <Card className="lg:sticky lg:top-2 lg:self-start lg:max-h-[calc(100vh-180px)] overflow-hidden">
            <CardContent className="p-0">
              <ScrollArea className="lg:max-h-[calc(100vh-180px)]">
                <div className="p-3 space-y-4" data-testid="help-sidebar">
                  {loadingList && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading…</div>}
                  {!loadingList && categories.length === 0 && (
                    <div className="text-xs text-muted-foreground">No articles match.</div>
                  )}
                  {categories.map(([cat, arts]) => (
                    <div key={cat}>
                      <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-2">{cat}</div>
                      <ul className="space-y-0.5">
                        {arts.map((a) => {
                          const isActive = active?.slug === a.slug;
                          return (
                            <li key={a.slug}>
                              <button
                                onClick={() => open(a.slug)}
                                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${isActive ? "bg-violet-500/15 text-violet-200" : "text-foreground/80 hover:bg-muted/50"}`}
                                data-testid={`help-nav-${a.slug}`}
                              >
                                <span className="w-4 text-center text-xs">{a.icon || "📘"}</span>
                                <span className="flex-1 truncate">{a.title}</span>
                                {isActive && <ChevronRight className="w-3 h-3" />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* ARTICLE */}
          <Card>
            <CardContent className="p-6">
              {loadingActive && <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading article…</div>}
              {!loadingActive && !active && (
                <div className="py-16 text-center text-sm text-muted-foreground" data-testid="help-empty">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  Pick an article from the left to start reading.
                </div>
              )}
              {!loadingActive && active && (
                <article className="space-y-4" data-testid="help-article">
                  <header className="space-y-1 border-b border-border/50 pb-4">
                    <div className="text-[10px] uppercase tracking-widest text-violet-400 flex items-center gap-2">
                      <span>{active.icon || "📘"}</span>{active.category}
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight" data-testid="help-article-title">{active.title}</h2>
                    {active.summary && <p className="text-sm text-muted-foreground">{active.summary}</p>}
                    <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] py-0">{active.slug}</Badge>
                      {active.updated_at && <span>Updated {new Date(active.updated_at).toLocaleDateString()}</span>}
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => { setEditing(active); setEditorOpen(true); }}
                            className="ml-auto text-emerald-400 hover:underline inline-flex items-center gap-1"
                            data-testid="help-edit-btn"
                          >
                            <Pencil className="w-3 h-3" />Edit
                          </button>
                          <button
                            onClick={() => onDelete(active.slug)}
                            className="text-rose-400 hover:underline"
                            data-testid="help-delete-btn"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </header>

                  <div
                    className="help-prose text-sm leading-relaxed"
                    data-testid="help-article-body"
                    dangerouslySetInnerHTML={{ __html: md.render(active.body_md || "") }}
                  />

                  {Array.isArray(active.screenshots) && active.screenshots.length > 0 && (
                    <div className="pt-4 border-t border-border/50 space-y-3">
                      <div className="text-[10px] uppercase tracking-widest text-violet-400">Screenshots</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {active.screenshots.map((s, idx) => (
                          <figure key={idx} className="rounded border border-border/50 overflow-hidden bg-muted/20">
                            <img src={s.url} alt={s.caption || ""} className="w-full h-auto" />
                            {s.caption && <figcaption className="text-xs text-muted-foreground p-2">{s.caption}</figcaption>}
                          </figure>
                        ))}
                      </div>
                    </div>
                  )}

                  <footer className="pt-4 border-t border-border/50 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-2">
                    <span>Was this helpful? Tell us in <Link to="/help/chat-presence" className="text-violet-400 hover:underline">#general</Link>.</span>
                    <span>NexusOps Help · v1</span>
                  </footer>
                </article>
              )}
            </CardContent>
          </Card>
        </div>

        {isAdmin && editorOpen && (
          <ArticleEditor
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
            initial={editing}
            onSave={onSave}
          />
        )}
      </div>

      {/* Inline prose styling — keeps tactical dark feel */}
      <style>{`
        .help-prose h1, .help-prose h2 { font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 0.5rem; color: hsl(var(--foreground)); }
        .help-prose h3 { font-size: 0.95rem; font-weight: 600; margin: 1rem 0 0.4rem; color: hsl(var(--foreground)); }
        .help-prose p { margin: 0.5rem 0; color: hsl(var(--foreground) / 0.85); }
        .help-prose ul, .help-prose ol { margin: 0.5rem 0 0.5rem 1.25rem; }
        .help-prose ul { list-style: disc; }
        .help-prose ol { list-style: decimal; }
        .help-prose li { margin: 0.25rem 0; }
        .help-prose code { background: hsl(var(--muted)); padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.85em; font-family: ui-monospace, SFMono-Regular, monospace; }
        .help-prose pre { background: hsl(var(--muted)); padding: 0.75rem; border-radius: 4px; overflow-x: auto; margin: 0.75rem 0; }
        .help-prose pre code { background: transparent; padding: 0; }
        .help-prose a { color: rgb(167 139 250); text-decoration: underline; }
        .help-prose strong { color: hsl(var(--foreground)); }
        .help-prose blockquote { border-left: 2px solid rgb(167 139 250); padding-left: 0.75rem; color: hsl(var(--muted-foreground)); margin: 0.75rem 0; }
        .help-prose table { border-collapse: collapse; margin: 0.75rem 0; width: 100%; font-size: 0.85em; }
        .help-prose th, .help-prose td { border: 1px solid hsl(var(--border)); padding: 0.4rem 0.6rem; text-align: left; }
        .help-prose th { background: hsl(var(--muted) / 0.5); }
      `}</style>
    </PageShell>
  );
}

function ArticleEditor({ open, onClose, initial, onSave }) {
  const [draft, setDraft] = useState(initial || {});
  useEffect(() => { setDraft(initial || {}); }, [initial]);

  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    if (!draft.title?.trim()) {
      toast.error("Title is required");
      return;
    }
    onSave({
      slug: draft.slug || "",
      title: draft.title,
      category: draft.category || "Uncategorised",
      icon: draft.icon || "📘",
      order: draft.order || 99,
      summary: draft.summary || "",
      body_md: draft.body_md || "",
      screenshots: draft.screenshots || [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="help-editor-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">{draft.slug ? "Edit article" : "New article"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Title</label>
              <Input value={draft.title || ""} onChange={(e) => update("title", e.target.value)} data-testid="help-edit-title" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Slug (optional)</label>
              <Input value={draft.slug || ""} onChange={(e) => update("slug", e.target.value)} placeholder="auto-from-title" data-testid="help-edit-slug" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Category</label>
              <Input value={draft.category || ""} onChange={(e) => update("category", e.target.value)} data-testid="help-edit-category" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Icon (emoji)</label>
              <Input value={draft.icon || ""} onChange={(e) => update("icon", e.target.value)} data-testid="help-edit-icon" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Summary</label>
            <Input value={draft.summary || ""} onChange={(e) => update("summary", e.target.value)} data-testid="help-edit-summary" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Body (Markdown)</label>
            <Textarea
              value={draft.body_md || ""}
              onChange={(e) => update("body_md", e.target.value)}
              rows={16}
              className="font-mono text-xs"
              data-testid="help-edit-body"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="help-edit-cancel">Cancel</Button>
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            onClick={submit}
            data-testid="help-edit-save"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
