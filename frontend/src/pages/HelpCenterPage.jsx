import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ChevronRight, CircleHelp,
  FileText, FolderOpen, Gauge, Image as ImageIcon, ListChecks, Loader2, Pencil,
  Plus, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({ html: true, breaks: true, linkify: true });

const categoryDetails = {
  "Release Notes": { label: "Release Notes", description: "What changed, what to review, and where to find the new workflow." },
  "Start here": { label: "Start here", description: "Daily operations, guidance, and what changed." },
  "Service desk": { label: "Service desk", description: "Triage, communication, dispatch, and incident response." },
  "Client operations": { label: "Client operations", description: "Client records, onboarding, account notices, and reviews." },
  "Infrastructure & security": { label: "Infrastructure & security", description: "Managed assets, backup, security, and controlled change." },
  "Platform setup": { label: "Platform setup", description: "Integrations, mail, calendars, voice, settings, and team access." },
  "Billing & commercial": { label: "Billing & commercial", description: "Invoices, recurring services, purchasing, and agreements." },
  "Reporting & evidence": { label: "Reporting & evidence", description: "Reports, QBRs, compliance evidence, and professional exports." },
  "Knowledge & Docs": { label: "Knowledge & Docs", description: "Knowledge articles, rich documentation, and reviewed auto-documentation." },
  "Automation & intelligence": { label: "Automation & intelligence", description: "Scripts, runbooks, alert rules, and AI-assisted operational workflows." },
};

const QUICK_STARTS = [
  { slug: "ticket-triage", label: "A customer needs help", detail: "Triage, scope, and create a safe service response.", icon: CircleHelp, tone: "emerald" },
  { slug: "work-ticket", label: "I need to work a ticket", detail: "Capture actions, communicate clearly, and close with evidence.", icon: ListChecks, tone: "cyan" },
  { slug: "client-360", label: "I am setting up a client", detail: "Build the connected client record and complete onboarding.", icon: FolderOpen, tone: "violet" },
  { slug: "backup-operations", label: "I need to verify protection", detail: "Check backup health and prove a restore path.", icon: ShieldCheck, tone: "amber" },
];

const GUIDE_SCAFFOLD = `## Outcome
State the exact, observable result a technician should achieve.

## At a glance
- **Expected time:** 10-15 minutes
- **Risk:** Low / Medium / High
- **Required access:** Name the role or permission
- **Evidence location:** Ticket, client history, activity log, or report

## Before you start
- Confirm the client, asset, ticket, or organisation scope.
- Confirm the required approval and maintenance window.
- Capture the current state so the change can be compared or reversed.

## Procedure
1. First controlled step.
2. Next step.
3. Validate the change.

## Verify the result
- Describe the live proof that the task is complete.
- Confirm the expected event, record, or client experience.

## Troubleshooting
- **Nothing changed:** Check scope, permissions, connection health, and the activity log.
- **Unexpected result:** Stop, preserve the evidence, and follow the rollback step.

## Rollback and escalation
Describe how to return to the previous safe state, when to stop, and who should own the escalation.

## Audit and handover
Record who acted, what changed, the result, approvals, timestamps, and any follow-up owner.

## Related guides
[Open the relevant NexusMSP workspace](/) and link the next useful guide.`;

function useApi(token) {
  return useMemo(() => ({
    get: (path) => axios.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.data),
    post: (path, body) => axios.post(`${API}${path}`, body || {}, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.data),
    del: (path) => axios.delete(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.data),
  }), [token]);
}

function safeHtml(markdown) {
  return DOMPurify.sanitize(md.render(markdown || ""), {
    ADD_ATTR: ["target", "rel"],
  });
}

function guideMatches(article, query) {
  const ignoredWords = new Set(["a", "an", "the", "to", "for", "how", "do", "i"]);
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter((token) => token && !ignoredWords.has(token));
  if (!tokens.length) return true;
  let searchable = [article?.title, article?.summary, article?.category, article?.slug]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const aliases = {
    "purchase order": "po",
    "knowledge base": "kb",
    "microsoft 365": "m365 o365",
    "managed asset": "rmm endpoint device",
    "quarterly business review": "qbr",
    "service level": "sla",
  };
  Object.entries(aliases).forEach(([phrase, shorthand]) => {
    if (searchable.includes(phrase)) searchable += ` ${shorthand}`;
  });
  return tokens.every((token) => searchable.includes(token));
}

function GuideEditor({ open, onOpenChange, article, onSave, token }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDraft({
      title: article?.title || "",
      slug: article?.slug || "",
      category: article?.category || "Service desk",
      icon: article?.icon || "📘",
      summary: article?.summary || "",
      body_md: article?.body_md || GUIDE_SCAFFOLD,
      screenshots: article?.screenshots || [],
      order: article?.order || 99,
    });
  }, [article, open]);

  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const uploadImage = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const response = await axios.post(`${API}/help/screenshots`, form, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
      });
      setDraft((current) => ({
        ...current,
        screenshots: [...(current.screenshots || []), { url: response.data.url, caption: file.name }],
      }));
      toast.success("Image added to this guide");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!draft?.title?.trim()) {
      toast.error("A guide title is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,900px)] max-w-6xl flex-col overflow-hidden border-emerald-500/20 bg-[#0c111c] p-0 text-foreground">
        <DialogHeader className="border-b border-white/[0.08] bg-gradient-to-r from-emerald-500/[0.10] via-card to-cyan-500/[0.05] px-7 py-5">
          <div className="flex items-start justify-between gap-4 pr-7">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Knowledge authoring</p>
              <DialogTitle className="text-xl">{article ? "Refine guide" : "Create a technician guide"}</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">Use the same outcome, procedure, verification, and audit standard in every guide.</p>
            </div>
            <Badge variant="outline" className="border-emerald-400/30 text-emerald-200">Rich text & images</Badge>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_250px]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[70px_minmax(0,1fr)]">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Icon</label>
                  <Input value={draft.icon} maxLength={4} onChange={(event) => update("icon", event.target.value)} className="text-center text-xl" aria-label="Guide icon" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Guide title</label>
                  <Input value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="e.g. Receive a ticket-linked purchase order" data-testid="help-guide-title" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Category</label>
                  <select value={draft.category} onChange={(event) => update("category", event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {[...Object.keys(categoryDetails), "Custom knowledge"].map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Sort order</label>
                  <Input type="number" value={draft.order} onChange={(event) => update("order", Number(event.target.value))} />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">What this guide helps with</label>
                <Textarea value={draft.summary} onChange={(event) => update("summary", event.target.value)} placeholder="A short, technician-focused purpose statement." className="min-h-[72px] resize-y" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-muted-foreground">Guide content</label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => update("body_md", GUIDE_SCAFFOLD)} className="h-7 text-xs text-emerald-300 hover:text-emerald-200">Restore procedure scaffold</Button>
                </div>
                <Textarea value={draft.body_md} onChange={(event) => update("body_md", event.target.value)} className="min-h-[360px] resize-y font-mono text-xs leading-6" placeholder="Markdown and safe HTML are supported." data-testid="help-guide-body" />
              </div>
            </div>
            <aside className="space-y-4">
              <Card className="border-white/[0.08] bg-black/15">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold">Writing standard</p>
                  <ol className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                    <li><span className="text-emerald-300">01</span> Start with the outcome.</li>
                    <li><span className="text-emerald-300">02</span> State access and safety checks.</li>
                    <li><span className="text-emerald-300">03</span> Write clear numbered actions.</li>
                    <li><span className="text-emerald-300">04</span> Show how to verify and audit.</li>
                  </ol>
                </CardContent>
              </Card>
              <Card className="border-white/[0.08] bg-black/15">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold">Guide images</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Add annotated screenshots or diagrams where a technician needs visual confirmation.</p>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => uploadImage(event.target.files?.[0])} />
                  <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />} Add image
                  </Button>
                  {!!draft.screenshots?.length && <div className="mt-3 space-y-2">
                    {draft.screenshots.map((shot, index) => <div key={`${shot.url}-${index}`} className="flex items-center gap-2 rounded border border-white/[0.08] p-2 text-xs">
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                      <span className="min-w-0 flex-1 truncate">{shot.caption || "Guide image"}</span>
                      <button type="button" className="text-muted-foreground hover:text-red-300" onClick={() => update("screenshots", draft.screenshots.filter((_, shotIndex) => shotIndex !== index))}>Remove</button>
                    </div>)}
                  </div>}
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
        <DialogFooter className="border-t border-white/[0.08] bg-black/15 px-7 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={save} disabled={saving} data-testid="help-save-guide-btn">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save guide
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HelpCenterPage() {
  const { token, user } = useAuth();
  const api = useApi(token);
  const { slug } = useParams();
  const navigate = useNavigate();
  const [library, setLibrary] = useState({ articles: [], by_category: {}, count: 0 });
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All guides");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState("");
  const [askingCopilot, setAskingCopilot] = useState(false);
  const isAdmin = (user?.role || "").toLowerCase() === "admin";

  const loadLibrary = async () => {
    setLoading(true);
    try {
      setLibrary(await api.get("/help/articles"));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load the Help Centre");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLibrary(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nextSlug = slug || library.articles?.[0]?.slug;
    if (!nextSlug || (active?.slug === nextSlug)) return;
    setLoadingArticle(true);
    api.get(`/help/articles/${nextSlug}`)
      .then((article) => {
        setActive(article);
        if (article.redirect_slug && article.redirect_slug !== nextSlug) {
          navigate(`/help/${article.redirect_slug}`, { replace: true });
        }
      })
      .catch((error) => {
        setActive(null);
        toast.error(error.response?.data?.detail || "Guide not found");
      })
      .finally(() => setLoadingArticle(false));
  }, [slug, library.articles, active?.slug, api]);

  const categories = useMemo(() => Object.entries(library.by_category || {}).sort(([left], [right]) => left.localeCompare(right)), [library.by_category]);
  const matchingArticles = useMemo(() => {
    const candidates = selectedCategory === "All guides" ? library.articles : (library.by_category?.[selectedCategory] || []);
    if (!query.trim()) return candidates;
    return library.articles.filter((article) => guideMatches(article, query));
  }, [library, query, selectedCategory]);
  const suggestions = useMemo(() => query.trim()
    ? library.articles.filter((article) => guideMatches(article, query)).slice(0, 6)
    : [], [library.articles, query]);

  const openGuide = (guideSlug) => {
    setSearchFocused(false);
    setQuery("");
    setSelectedCategory("All guides");
    navigate(`/help/${guideSlug}`);
  };

  const saveGuide = async (draft) => {
    try {
      const saved = await api.post("/help/articles", draft);
      toast.success("Guide saved");
      await loadLibrary();
      navigate(`/help/${saved.slug}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save guide");
      throw error;
    }
  };

  const refreshShippedGuides = async () => {
    try {
      const result = await api.post("/help/seed");
      toast.success(`${result.seeded} product guides refreshed`);
      await loadLibrary();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to refresh product guides");
    }
  };

  const deleteGuide = async () => {
    if (!active || !window.confirm(`Delete “${active.title}”?`)) return;
    try {
      await api.del(`/help/articles/${active.slug}`);
      toast.success("Guide deleted");
      setActive(null);
      navigate("/help");
      await loadLibrary();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to delete guide");
    }
  };

  const askCopilot = async (event) => {
    event.preventDefault();
    if (!copilotQuestion.trim()) return;
    setAskingCopilot(true);
    try {
      const result = await api.post("/help/copilot", { question: copilotQuestion, article_slug: active?.slug });
      setCopilotAnswer(result.answer || result.response || "No recommendation was returned.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to ask the Help Co-pilot");
    } finally {
      setAskingCopilot(false);
    }
  };

  return (
    <PageShell data-testid="help-center-page">
      {/* Documentation Hub hides the first embedded legacy header. Keep this
          placeholder so the complete Help Centre body remains visible there. */}
      <div className="hidden" aria-hidden="true" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/[0.11] via-card to-cyan-500/[0.05] p-5">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">NexusMSP knowledge</p>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><CircleHelp className="h-6 w-6 text-emerald-300" />Help Centre</h1>
            <p className="mt-1 text-sm text-muted-foreground">Task-first guides for safe, consistent service delivery — with verification and audit built in.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && <Button size="sm" variant="outline" onClick={refreshShippedGuides} data-testid="help-reseed-btn"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh product guides</Button>}
            {isAdmin && <Button size="sm" className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => { setEditing(null); setEditorOpen(true); }} data-testid="help-new-article-btn"><Plus className="mr-1.5 h-4 w-4" />New guide</Button>}
          </div>
        </header>

        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-card/80 p-4 shadow-[0_20px_60px_-42px_rgba(34,211,238,0.55)]" aria-label="Start a guided task">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-300">Start with the outcome</p>
              <h2 className="mt-1 text-lg font-semibold">What are you trying to do?</h2>
            </div>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">Choose the outcome in front of you. Nexus will open the matching task-first guide with readiness, execution, verification, and evidence steps.</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {QUICK_STARTS.map(({ slug: quickStartSlug, label, detail, icon: Icon, tone }) => {
              const toneClass = {
                emerald: "hover:border-emerald-400/30 hover:bg-emerald-500/[0.055] group-hover:bg-emerald-500/12 group-hover:text-emerald-300",
                cyan: "hover:border-cyan-400/30 hover:bg-cyan-500/[0.055] group-hover:bg-cyan-500/12 group-hover:text-cyan-300",
                violet: "hover:border-violet-400/30 hover:bg-violet-500/[0.055] group-hover:bg-violet-500/12 group-hover:text-violet-300",
                amber: "hover:border-amber-400/30 hover:bg-amber-500/[0.055] group-hover:bg-amber-500/12 group-hover:text-amber-300",
              }[tone];
              return <button key={quickStartSlug} type="button" onClick={() => openGuide(quickStartSlug)} className={`group flex min-h-[104px] items-start gap-3 rounded-xl border border-white/[0.07] bg-black/[0.12] p-3.5 text-left transition ${toneClass}`} data-testid={`help-quick-start-${quickStartSlug}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-muted-foreground transition"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">{label}</span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" /></span><span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{detail}</span></span>
              </button>;
            })}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3" aria-label="Help Centre status">
          <Card className="border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.08] to-card"><CardContent className="flex items-center gap-3 p-4"><BookOpen className="h-5 w-5 text-emerald-300" /><div><p className="text-xl font-bold">{library.count || library.articles.length}</p><p className="text-xs text-muted-foreground">Operational guides</p></div></CardContent></Card>
          <Card className="border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.08] to-card"><CardContent className="flex items-center gap-3 p-4"><FolderOpen className="h-5 w-5 text-cyan-300" /><div><p className="text-xl font-bold">{categories.length}</p><p className="text-xs text-muted-foreground">Clear work areas</p></div></CardContent></Card>
          <Card className="border-violet-500/15 bg-gradient-to-br from-violet-500/[0.08] to-card"><CardContent className="flex items-center gap-3 p-4"><ShieldCheckIcon /><div><p className="text-sm font-semibold">Prepare → execute → verify → record</p><p className="text-xs text-muted-foreground">Troubleshooting and recovery included</p></div></CardContent></Card>
        </section>

        <section className="relative rounded-2xl border border-white/[0.08] bg-card/80 p-4 shadow-[0_20px_60px_-42px_rgba(16,185,129,0.65)]">
          <form onSubmit={(event) => { event.preventDefault(); if (suggestions[0]) openGuide(suggestions[0].slug); }} className="flex items-center gap-3">
            <Search className="h-5 w-5 shrink-0 text-emerald-300" />
            <Input value={query} onFocus={() => setSearchFocused(true)} onChange={(event) => setQuery(event.target.value)} placeholder="Search a task, workspace, or integration — e.g. “receive a PO”" className="h-11 border-0 bg-transparent text-base shadow-none focus-visible:ring-0" data-testid="help-search-input" />
            {query && <Button type="button" variant="ghost" size="sm" onClick={() => { setQuery(""); setSelectedCategory("All guides"); }}>Clear</Button>}
            <Button type="submit" size="sm" className="hidden bg-emerald-500 text-emerald-950 hover:bg-emerald-400 sm:inline-flex">Find guide</Button>
          </form>
          {searchFocused && suggestions.length > 0 && <div className="absolute inset-x-3 top-[calc(100%-3px)] z-20 overflow-hidden rounded-xl border border-white/[0.10] bg-[#101723] p-1 shadow-2xl" data-testid="help-search-suggestions">
            {suggestions.map((article) => <button key={article.slug} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openGuide(article.slug)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-emerald-500/[0.10]">
              <span className="text-lg">{article.icon || "📘"}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{article.title}</span><span className="block truncate text-xs text-muted-foreground">{article.category}</span></span><ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>)}
          </div>}
        </section>

        <div className="grid gap-5 lg:grid-cols-[235px_minmax(0,1fr)] 2xl:grid-cols-[235px_minmax(0,1fr)_270px]">
          <aside className="space-y-3">
            <Card className="border-white/[0.08] bg-card/80"><CardContent className="p-3">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Browse by work area</p>
              <button type="button" onClick={() => { setSelectedCategory("All guides"); setQuery(""); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${selectedCategory === "All guides" ? "bg-emerald-500/15 text-emerald-200" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"}`}><span>All guides</span><Badge variant="secondary" className="h-5 bg-black/20 text-[10px]">{library.articles.length}</Badge></button>
              <div className="mt-1 space-y-1">
                {categories.map(([category, articles]) => <button key={category} type="button" onClick={() => { setSelectedCategory(category); setQuery(""); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selectedCategory === category ? "bg-emerald-500/15 text-emerald-200" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"}`}><span className="truncate">{category}</span><span className="ml-2 text-xs">{articles.length}</span></button>)}
              </div>
            </CardContent></Card>
            <Card className="border-emerald-500/15 bg-emerald-500/[0.05]"><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-emerald-300" />Need a new guide?</p><p className="mt-2 text-xs leading-5 text-muted-foreground">The authoring scaffold now captures prerequisites, risk, verification, troubleshooting, rollback, and audit evidence.</p>{isAdmin && <Button variant="link" size="sm" className="mt-2 h-auto px-0 text-emerald-300" onClick={() => { setEditing(null); setEditorOpen(true); }}>Create one <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>}</CardContent></Card>
          </aside>

          <main className="min-w-0 space-y-4">
            {loading ? <Card><CardContent className="flex min-h-[440px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-300" /></CardContent></Card> : query || selectedCategory !== "All guides" ? <>
              <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Guide catalogue</p><h2 className="mt-1 text-xl font-semibold">{query ? `Results for “${query}”` : selectedCategory}</h2></div><span className="text-sm text-muted-foreground">{matchingArticles.length} guide{matchingArticles.length === 1 ? "" : "s"}</span></div>
              <div className="grid gap-3 md:grid-cols-2">
                {matchingArticles.map((article) => <button key={article.slug} type="button" onClick={() => openGuide(article.slug)} className={`group rounded-xl border p-4 text-left transition ${active?.slug === article.slug ? "border-emerald-400/40 bg-emerald-500/[0.07]" : "border-white/[0.08] bg-card/75 hover:border-emerald-400/25 hover:bg-emerald-500/[0.04]"}`} data-testid={`help-nav-${article.slug}`}><div className="flex items-start gap-3"><span className="text-xl">{article.icon || "📘"}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="truncate font-semibold">{article.title}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-emerald-300" /></span><span className="mt-1 block text-xs text-emerald-300">{article.category}</span><span className="mt-2 line-clamp-2 block text-sm leading-5 text-muted-foreground">{article.summary}</span></span></div></button>)}
                {!matchingArticles.length && <Card className="md:col-span-2"><CardContent className="p-8 text-center"><FileText className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 font-medium">No guide matches that yet</p><p className="mt-1 text-sm text-muted-foreground">Try a different task or create a custom team guide.</p></CardContent></Card>}
              </div>
            </> : loadingArticle ? <Card><CardContent className="flex min-h-[440px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-300" /></CardContent></Card> : active ? <ArticleReader active={active} isAdmin={isAdmin} onEdit={() => { setEditing(active); setEditorOpen(true); }} onDelete={deleteGuide} /> : <Card><CardContent className="p-10 text-center text-muted-foreground">Choose a guide to begin.</CardContent></Card>}
          </main>

          <aside className="space-y-4 lg:col-span-2 2xl:col-span-1">
            <Card className="border-cyan-500/20 bg-gradient-to-b from-cyan-500/[0.08] to-card"><CardContent className="p-4"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-300" /><p className="text-sm font-semibold">Help Co-pilot</p></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Ask for the next safe step. Answers stay grounded in your NexusMSP guide library.</p><form onSubmit={askCopilot} className="mt-3 space-y-2"><Textarea value={copilotQuestion} onChange={(event) => setCopilotQuestion(event.target.value)} placeholder="What should I verify before…" className="min-h-[86px] resize-none text-sm" /><Button type="submit" size="sm" className="w-full bg-cyan-400 text-cyan-950 hover:bg-cyan-300" disabled={askingCopilot}>{askingCopilot ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Ask Co-pilot</Button></form>{copilotAnswer && <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/15 p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">{copilotAnswer}</div>}</CardContent></Card>
            {active && <Card className="border-white/[0.08] bg-card/80"><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Guide checklist</p><div className="mt-3 space-y-3 text-sm"><ChecklistItem label="Confirm scope, access, and approval" /><ChecklistItem label="Capture the safe starting state" /><ChecklistItem label="Complete the controlled steps" /><ChecklistItem label="Verify the live result and recovery" /><ChecklistItem label="Attach evidence and hand over" /></div></CardContent></Card>}
          </aside>
        </div>
      </div>
      <GuideEditor open={editorOpen} onOpenChange={setEditorOpen} article={editing} onSave={saveGuide} token={token} />
    </PageShell>
  );
}

function ShieldCheckIcon() {
  return <CheckCircle2 className="h-5 w-5 text-violet-300" />;
}

function ChecklistItem({ label }) {
  return <div className="flex gap-2"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-400/35"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /></span><span className="text-muted-foreground">{label}</span></div>;
}

function splitGuideSections(markdown) {
  const parts = String(markdown || "").split(/^##\s+(.+)$/m);
  const sections = {};
  for (let index = 1; index < parts.length; index += 2) {
    sections[parts[index].trim().toLowerCase()] = (parts[index + 1] || "").trim();
  }
  return sections;
}

function copyBlocks(markdown) {
  return String(markdown || "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function guideItems(markdown) {
  const source = String(markdown || "").trim();
  if (!source) return [];
  const lines = source.split(/\n/);
  const items = [];
  let current = [];
  const flush = () => {
    const value = current.join(" ").trim();
    if (value) items.push(value);
    current = [];
  };
  lines.forEach((line) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flush();
      items.push(bullet[1].trim());
    } else if (!line.trim()) {
      flush();
    } else {
      current.push(line.trim());
    }
  });
  flush();
  return items;
}

function procedureSteps(markdown) {
  const matches = [...String(markdown || "").matchAll(/(?:^|\n)\s*\d+\.\s+([\s\S]*?)(?=(?:\n\s*\d+\.\s+)|$)/g)];
  if (matches.length) return matches.map((match) => match[1].trim().replace(/\n+/g, " "));
  return copyBlocks(markdown).map((block) => block.replace(/^[-*]\s+/, ""));
}

function InlineGuideCopy({ children, className = "" }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(md.renderInline(String(children || "").replace(/\n/g, " "))) }} />;
}

function GuideMarkdown({ children, className = "" }) {
  return <div className={`text-sm leading-6 text-muted-foreground [&_a]:font-medium [&_a]:text-emerald-300 [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-black/25 [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:ml-5 [&_li]:list-disc [&_ol]:space-y-2 [&_ol]:pl-5 [&_ol]:marker:text-emerald-300 [&_p+p]:mt-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-white/10 [&_td]:p-3 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/[0.04] [&_th]:p-3 [&_th]:text-left [&_th]:text-foreground [&_ul]:space-y-2 ${className}`} dangerouslySetInnerHTML={{ __html: safeHtml(children) }} />;
}

function GuideSection({ id, eyebrow, title, icon: Icon, tone = "emerald", children }) {
  const tones = {
    emerald: "border-emerald-400/18 bg-emerald-500/[0.045] text-emerald-300",
    cyan: "border-cyan-400/18 bg-cyan-500/[0.045] text-cyan-300",
    violet: "border-violet-400/18 bg-violet-500/[0.045] text-violet-300",
    amber: "border-amber-400/18 bg-amber-500/[0.045] text-amber-300",
    red: "border-red-400/18 bg-red-500/[0.045] text-red-300",
  };
  return <section id={id} className={`scroll-mt-24 rounded-2xl border p-5 sm:p-6 ${tones[tone]}`}>
    <div className="mb-5 flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/25 bg-black/15"><Icon className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-75">{eyebrow}</p><h3 className="mt-0.5 text-lg font-semibold text-foreground">{title}</h3></div></div>
    {children}
  </section>;
}

function GenericGuideBody({ body }) {
  return <div className="rounded-2xl border border-white/[0.08] bg-black/[0.12] p-6 sm:p-7" data-testid="help-article-body">
    <div className="space-y-5 text-sm leading-7 text-muted-foreground [&_a]:text-emerald-300 [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-white/[0.08] [&_h2]:pb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ol]:space-y-2 [&_ol]:pl-5 [&_ol]:marker:text-emerald-300 [&_ul]:space-y-2" dangerouslySetInnerHTML={{ __html: safeHtml(body) }} />
  </div>;
}

function GuideVisualReferences({ screenshots = [] }) {
  if (!screenshots.length) return null;
  return <GuideSection id="guide-visual-reference" eyebrow="Workspace reference" title="What you should see" icon={ImageIcon} tone="cyan">
    <p className="mb-4 text-sm leading-6 text-muted-foreground">Use this live NexusMSP workspace reference to orient yourself before making a change. Values and client names may differ in your environment.</p>
    <div className={screenshots.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>{screenshots.map((shot, index) => <figure key={`${shot.url}-${index}`} className="overflow-hidden rounded-xl border border-cyan-400/15 bg-black/15"><img src={shot.url.startsWith("http") ? shot.url : `${API}${shot.url}`} alt={shot.caption || "Guide reference"} className="max-h-[30rem] w-full object-contain" /><figcaption className="border-t border-white/[0.08] px-3 py-2 text-xs text-muted-foreground">{shot.caption || "Guide reference"}</figcaption></figure>)}</div>
  </GuideSection>;
}

function OperationalGuideBody({ body, screenshots = [] }) {
  const sections = splitGuideSections(body);
  const outcome = sections.outcome;
  const atAGlance = sections["at a glance"];
  const before = sections["before you start"];
  const procedure = sections.procedure;
  const verify = sections["verify the result"];
  const troubleshooting = sections.troubleshooting;
  const rollback = sections["rollback and escalation"];
  const audit = sections["audit and handover"];
  const related = sections["related guides"];
  if (!(outcome && before && procedure && verify && audit)) return <GenericGuideBody body={body} />;
  const steps = procedureSteps(procedure);

  return <div className="space-y-5" data-testid="help-article-body">
    <div className="grid gap-2 rounded-2xl border border-white/[0.08] bg-black/[0.14] p-3 sm:grid-cols-4" aria-label="Guide completion path">
      {[
        ["01", "Prepare", ShieldCheck, "Review access & scope"],
        ["02", "Execute", ListChecks, "Complete the runbook"],
        ["03", "Verify", CheckCircle2, "Prove the result"],
        ["04", "Record", FileText, "Retain the evidence"],
      ].map(([number, label, Icon, note], index) => <div key={label} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${index === 1 ? "bg-emerald-500/[0.10]" : "bg-white/[0.025]"}`}><span className="font-mono text-[11px] text-emerald-300">{number}</span><Icon className="h-4 w-4 text-emerald-300" /><span><span className="block text-xs font-semibold text-foreground">{label}</span><span className="block text-[11px] text-muted-foreground">{note}</span></span></div>)}
    </div>

    <GuideSection id="guide-outcome" eyebrow="Definition of done" title="Outcome" icon={Sparkles} tone="emerald">
      <div className="rounded-xl border border-emerald-400/15 bg-black/[0.16] px-4 py-4"><InlineGuideCopy className="text-base font-medium leading-7 text-foreground">{outcome}</InlineGuideCopy></div>
    </GuideSection>

    {atAGlance && <GuideSection id="guide-at-a-glance" eyebrow="Operational profile" title="At a glance" icon={Gauge} tone="violet">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{guideItems(atAGlance).map((block, index) => <div key={index} className="rounded-xl border border-violet-400/12 bg-black/[0.14] p-4"><InlineGuideCopy className="text-sm leading-6 text-muted-foreground">{block}</InlineGuideCopy></div>)}</div>
    </GuideSection>}

    <GuideVisualReferences screenshots={screenshots} />

    <GuideSection id="guide-before" eyebrow="Readiness check" title="Before you start" icon={ShieldCheck} tone="amber">
      <div className="grid gap-3 sm:grid-cols-2">{guideItems(before).map((block, index) => <div key={index} className="flex gap-3 rounded-xl border border-amber-400/12 bg-black/[0.14] p-4"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-300/35 text-[10px] font-bold text-amber-200">{index + 1}</span><InlineGuideCopy className="text-sm leading-6 text-muted-foreground">{block}</InlineGuideCopy></div>)}</div>
    </GuideSection>

    <GuideSection id="guide-procedure" eyebrow={`${steps.length} controlled step${steps.length === 1 ? "" : "s"}`} title="Procedure" icon={ListChecks} tone="cyan">
      <ol className="space-y-3">{steps.map((step, index) => <li key={index} className="group flex gap-4 rounded-xl border border-cyan-400/12 bg-black/[0.14] p-4 transition hover:border-cyan-300/30"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-500/[0.10] font-mono text-xs font-semibold text-cyan-200">{String(index + 1).padStart(2, "0")}</span><InlineGuideCopy className="min-w-0 pt-1 text-sm leading-6 text-foreground">{step}</InlineGuideCopy></li>)}</ol>
    </GuideSection>

    <div className="grid gap-5 lg:grid-cols-2">
      <GuideSection id="guide-verify" eyebrow="Quality gate" title="Verify the result" icon={CheckCircle2} tone="violet">
        <div className="space-y-3">{guideItems(verify).map((block, index) => <div key={index} className="flex gap-3 rounded-xl border border-violet-400/12 bg-black/[0.14] p-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><InlineGuideCopy className="text-sm leading-6 text-muted-foreground">{block}</InlineGuideCopy></div>)}</div>
      </GuideSection>
      <GuideSection id="guide-audit" eyebrow="Evidence & handover" title="Audit and handover" icon={FileText} tone="emerald">
        <div className="space-y-3">{guideItems(audit).map((block, index) => <div key={index} className="flex gap-3 rounded-xl border border-emerald-400/12 bg-black/[0.14] p-4"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><InlineGuideCopy className="text-sm leading-6 text-muted-foreground">{block}</InlineGuideCopy></div>)}</div>
      </GuideSection>
    </div>

    {(troubleshooting || rollback) && <div className="grid gap-5 lg:grid-cols-2">
      {troubleshooting && <GuideSection id="guide-troubleshooting" eyebrow="Exception handling" title="Troubleshooting" icon={AlertTriangle} tone="amber">
        <GuideMarkdown>{troubleshooting}</GuideMarkdown>
      </GuideSection>}
      {rollback && <GuideSection id="guide-rollback" eyebrow="Safe recovery" title="Rollback and escalation" icon={RotateCcw} tone="red">
        <GuideMarkdown>{rollback}</GuideMarkdown>
      </GuideSection>}
    </div>}

    {related && <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-500/[0.07] to-cyan-500/[0.04] px-5 py-5"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-black/15"><ArrowRight className="h-4 w-4 text-emerald-300" /></span><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Next useful action</p><GuideMarkdown>{related}</GuideMarkdown></div></div></div>}
  </div>;
}

function ArticleReader({ active, isAdmin, onEdit, onDelete }) {
  const screenshots = active.screenshots || [];
  return <article className="overflow-hidden rounded-[22px] border border-white/[0.09] bg-card/90 shadow-[0_24px_80px_-50px_rgba(34,211,238,0.55)]" data-testid="help-article">
    <header className="relative overflow-hidden border-b border-white/[0.08] bg-[radial-gradient(circle_at_0%_0%,rgba(16,185,129,0.18),transparent_38%),linear-gradient(110deg,rgba(16,185,129,0.10),rgba(15,23,42,0.25),rgba(6,182,212,0.07))] px-6 py-7 sm:px-8">
      <div className="absolute right-0 top-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-cyan-400/[0.08] blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-5"><div className="flex min-w-0 items-start gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-500/[0.12] text-3xl shadow-inner shadow-emerald-300/10">{active.icon || "📘"}</span><div><div className="mb-3 flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-emerald-400/30 bg-emerald-500/[0.06] text-emerald-200">{active.category}</Badge><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />Operational runbook</span></div><h2 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="help-article-title">{active.title}</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">{active.summary}</p></div></div>{isAdmin && <div className="flex gap-2"><Button size="sm" variant="outline" className="bg-black/15" onClick={onEdit} data-testid="help-edit-btn"><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit guide</Button><Button size="sm" variant="ghost" className="text-red-300 hover:bg-red-500/[0.08] hover:text-red-200" onClick={onDelete}>Delete</Button></div>}</div>
    </header>
    <div className="p-5 sm:p-7 lg:p-8"><OperationalGuideBody body={active.body_md} screenshots={screenshots} />
    </div>
  </article>;
}
