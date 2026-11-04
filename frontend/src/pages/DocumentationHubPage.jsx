/**
 * Documentation Hub — the front door to everything Nexus knows.
 *
 * The tab shell used to be the whole page: five tabs and nothing that helped a
 * technician decide which one to open, or find a guide they half-remember. This
 * hub now searches both libraries at once, shows *why* each result matched, and
 * keeps a short list of what this technician actually uses — while every tab it
 * hosts keeps working exactly as it did, including the legacy embedded-header
 * contract each child page relies on.
 *
 * The search covers the documents this page loaded under the caller's own
 * permissions (the guide library and the knowledge library), and it says so: a
 * result is never presented as evidence that no answer exists anywhere.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import KnowledgeBasePage from "./KnowledgeBasePage";
import ITDocumentationPage from "./ITDocumentationPage";
import AutoDocumentationPage from "./AutoDocumentationPage";
import HelpCenterPage from "./HelpCenterPage";
import CapacityPlannerPage from "./CapacityPlannerPage";
import {
  BookOpen, ChartNoAxesCombined, CircleHelp, Clock, Compass, FileText, History,
  Loader2, RefreshCw, Search, Sparkles, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  categoryLabel, categoryStyle, documentUpdatedAt, pickPopular, pickRecentlyUpdated,
  queryTokens, readingMinutes, searchDocuments,
} from "@/components/knowledge/knowledgeSearch";
import {
  KNOWLEDGE_KINDS, knowledgeCount, knowledgeHint, recentlyRead, rememberKnowledge,
} from "@/components/knowledge/knowledgeLearning";
import { useWorkspaceLearning } from "@/hooks/useWorkspaceLearning";
import { LEARNING_WORKSPACES } from "@/lib/workspaceLearning";
import {
  EmptySearchState, KnowledgeLoading, KnowledgeMemoryBar, MatchEvidence, UseCountBadge,
} from "@/components/knowledge/KnowledgeReadingKit";

// Tab order is deliberately unchanged: the hub adds a front door in front of
// these workspaces, it does not renumber what technicians already navigate to.
const DOC_TABS = [
  { value: "library", label: "Knowledge Base", icon: BookOpen, component: KnowledgeBasePage },
  { value: "it-docs", label: "IT Docs", icon: FileText, component: ITDocumentationPage },
  { value: "automation", label: "Auto-Docs", icon: Sparkles, component: AutoDocumentationPage },
  { value: "help", label: "Help Centre", icon: CircleHelp, component: HelpCenterPage },
  { value: "capacity", label: "Capacity", icon: ChartNoAxesCombined, component: CapacityPlannerPage },
];

function EmbeddedWorkspace({ children }) {
  // Each embedded workspace already has its own standalone header. Hide that
  // list-level header inside the hub, but keep focused record/detail headers
  // visible so technicians always retain title, context and a way back.
  return <div className="[&>[data-testid=knowledge-base-page]>:first-child]:hidden [&>[data-testid=documentation-page]>:first-child]:hidden [&>[data-testid=auto-documentation-page]>:first-child]:hidden [&>[data-testid=help-center-page]>:first-child]:hidden [&>[data-testid=capacity-planner-page]>:first-child]:hidden">{children}</div>;
}

/** One guide or article, presented with the evidence that put it there. */
function SearchResult({ result, onOpen }) {
  const { document: doc } = result;
  const isGuide = doc.kind === "guide";
  return (
    <button
      type="button"
      onClick={() => onOpen(result)}
      className="group w-full rounded-2xl border border-border/70 bg-card/80 p-4 text-left transition hover:border-sky-400/35 hover:bg-sky-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
      data-testid={`hub-result-${result.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none">{isGuide ? (doc.icon || "📘") : "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{doc.title}</span>
            <Badge variant="outline" className="rounded-full border-border/70 bg-background/40 text-[10px] font-normal">{isGuide ? "Guide" : "Article"}</Badge>
            <Badge variant="outline" className={`rounded-full text-[10px] font-normal ${isGuide ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200" : categoryStyle(doc.category)}`}>
              {isGuide ? (doc.category || "Product guidance") : categoryLabel(doc.category)}
            </Badge>
          </span>
          <MatchEvidence className="mt-2" matched={result.matched} snippet={result.snippet} />
        </span>
      </div>
    </button>
  );
}

function CompactRow({ document, onOpen, meta, extra }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(document)}
      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-sky-400/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
      data-testid={`hub-shortcut-${document.slug || document.id}`}
    >
      <span className="text-base leading-none">{document.icon || "📘"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{document.title}</span>
        {meta ? <span className="block truncate text-[11px] text-muted-foreground">{meta}</span> : null}
      </span>
      {extra}
    </button>
  );
}

export default function DocumentationHubPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") || "library");
  const [guides, setGuides] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState(() => searchParams.get("q") || "");
  const [forgetting, setForgetting] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  // The hub learns through the shared workspace store, like every other
  // workspace: the server owns the counters and the tenant-wide aggregate.
  const learning = useWorkspaceLearning(token, LEARNING_WORKSPACES.DOCUMENTATION);
  const { record } = learning;

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (DOC_TABS.some(item => item.value === requested) && requested !== tab) setTab(requested);
  }, [searchParams, tab]);

  const loadLibraries = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const [guideResult, articleResult] = await Promise.allSettled([
      axios.get(`${API}/help/articles`, { headers }),
      axios.get(`${API}/kb/articles`, { headers }),
    ]);
    // One library failing must not hide the other one: they are separate
    // endpoints, and a technician with a broken Knowledge Base still needs the
    // product guides to be reachable.
    if (guideResult.status === "fulfilled") {
      setGuides(Array.isArray(guideResult.value.data?.articles) ? guideResult.value.data.articles : []);
    } else {
      setGuides([]);
    }
    if (articleResult.status === "fulfilled") {
      setArticles(Array.isArray(articleResult.value.data) ? articleResult.value.data : []);
    } else {
      setArticles([]);
    }
    if (guideResult.status === "rejected" && articleResult.status === "rejected") {
      setLoadError("Nexus could not reach the guide or knowledge libraries. Nothing has been changed — try again in a moment.");
    } else if (articleResult.status === "rejected") {
      setLoadError("The knowledge library is unavailable, so this search only covers product guides right now.");
    } else if (guideResult.status === "rejected") {
      setLoadError("The product guide library is unavailable, so this search only covers knowledge articles right now.");
    }
    setLoading(false);
  }, [headers]);

  useEffect(() => { loadLibraries(); }, [loadLibraries]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectTab = useCallback((value) => {
    setTab(value);
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const searchable = useMemo(() => ([
    ...guides.map((guide) => ({ ...guide, kind: "guide", id: guide.slug, source: "Help Centre" })),
    ...articles.map((article) => ({ ...article, kind: "article", source: "Knowledge Base" })),
  ]), [guides, articles]);

  const results = useMemo(
    () => searchDocuments(searchable, query, { limit: 14, idOf: (doc) => `${doc.kind}:${doc.id}` }),
    [searchable, query],
  );

  const tokens = useMemo(() => queryTokens(query), [query]);

  const nearMisses = useMemo(() => {
    // A no-results state still owes the technician something: the guides that
    // match any single word of what they typed, closest first. This is a
    // deliberately weaker match than the search itself, and it is labelled as
    // "closest" rather than presented as a result.
    if (!tokens.length || results.length) return [];
    return guides
      .map((guide) => ({ guide, hits: tokens.filter((token) => `${guide.title} ${guide.summary} ${guide.category} ${(guide.tags || []).join(" ")}`.toLowerCase().includes(token)).length }))
      .filter((entry) => entry.hits > 0)
      .sort((left, right) => right.hits - left.hits)
      .slice(0, 4)
      .map((entry) => ({ ...entry.guide, id: entry.guide.slug, category_label: entry.guide.category }));
  }, [guides, tokens, results.length]);

  const jumpBackIn = useMemo(
    () => recentlyRead(learning, searchable, { kind: KNOWLEDGE_KINDS.ARTICLE, idOf: (doc) => doc.id, limit: 4 }),
    [searchable, learning],
  );
  const recentlyOpenedGuides = useMemo(
    () => recentlyRead(learning, searchable, { kind: KNOWLEDGE_KINDS.GUIDE, idOf: (doc) => doc.id, limit: 4 }),
    [searchable, learning],
  );
  const popular = useMemo(() => pickPopular(searchable, 5), [searchable]);
  const recentlyUpdated = useMemo(() => pickRecentlyUpdated(searchable, 5), [searchable]);
  // Both libraries are one workspace, so a single hint describes the reader as a
  // whole — which is what a hub searching both at once should say.
  const memoryHint = useMemo(() => knowledgeHint(learning), [learning]);

  const openDocument = useCallback((document) => {
    if (document.kind === "guide") {
      rememberKnowledge(record, KNOWLEDGE_KINDS.GUIDE, document.slug);
      navigate(`/help/${document.slug}`);
      return;
    }
    rememberKnowledge(record, KNOWLEDGE_KINDS.ARTICLE, document.id);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "library");
    next.set("article", String(document.id));
    setTab("library");
    setSearchParams(next, { replace: true });
  }, [navigate, record, searchParams, setSearchParams]);

  const openResult = useCallback((result) => openDocument({ ...result.document, kind: result.kind, id: result.document.slug || result.document.id }), [openDocument]);

  const submitSearch = (event) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set("q", query.trim()); else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const clearSearch = () => {
    setQuery("");
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const askCopilot = () => {
    // The co-pilot lives on the Help tab and reads the same `q` parameter, so
    // the question travels with the technician instead of being retyped.
    const next = new URLSearchParams(searchParams);
    next.set("tab", "help");
    if (query.trim()) next.set("q", query.trim());
    setTab("help");
    setSearchParams(next, { replace: true });
  };

  const forgetLearning = async () => {
    setForgetting(true);
    try {
      const removed = await learning.forget();
      toast.success(`Forgot ${removed} learned signal${removed === 1 ? "" : "s"}`, {
        description: "Guides and articles are back in the order Nexus shipped them and will learn again from your next read.",
      });
    } catch {
      toast.error("Nexus could not clear the learned ordering. Nothing has been changed.");
    } finally {
      setForgetting(false);
    }
  };

  const documentCount = searchable.length;
  const isSearching = Boolean(tokens.length);

  return (
    <div className="space-y-5" data-testid="documentation-hub-page">
      <OperationalPageHeader
        eyebrow="Knowledge operations"
        title="Knowledge & Docs"
        description="One workspace for technician documentation, client knowledge, automation output, product guidance, and capacity planning."
        icon={BookOpen}
        tone="sky"
        actions={<>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={loadLibraries} disabled={loading} data-testid="hub-refresh">
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh
          </Button>
          <Button size="sm" className="rounded-xl bg-cyan-400 text-cyan-950 hover:bg-cyan-300" onClick={askCopilot} data-testid="hub-ask-copilot">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />Ask the co-pilot
          </Button>
        </>}
      />

      <section className="overflow-hidden rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-400/[0.07] via-card to-card shadow-[0_24px_70px_-52px_rgba(56,189,248,0.6)]" aria-label="Search everything Nexus knows">
        <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-3 p-4">
          <Search className="h-5 w-5 shrink-0 text-sky-300" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search guides and articles — try “receive a purchase order”, “winget”, or “restore a mailbox”"
            className="h-11 min-w-[14rem] flex-1 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
            data-testid="hub-search-input"
            aria-label="Search the knowledge base and help centre"
          />
          {query ? <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={clearSearch}>Clear</Button> : null}
          <Button type="submit" size="sm" className="rounded-xl" data-testid="hub-search-submit">Search</Button>
        </form>
        <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          {loading
            ? "Loading the libraries…"
            : `Searching ${guides.length} product guide${guides.length === 1 ? "" : "s"} and ${articles.length} knowledge article${articles.length === 1 ? "" : "s"} you can read. Nexus shows which field matched, so a result never appears without a reason.`}
        </p>
      </section>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-xs leading-5 text-amber-100" role="status" data-testid="hub-load-error">
          <span className="min-w-0 flex-1">{loadError}</span>
          <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-[11px]" onClick={loadLibraries}>Try again</Button>
        </div>
      ) : null}

      {isSearching ? (
        loading ? <KnowledgeLoading label="Searching the libraries" /> : (
          <section className="space-y-3" aria-label="Search results">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-300">Search results</p>
                <h2 className="mt-1 text-xl font-semibold">“{query.trim()}”</h2>
              </div>
              <span className="text-sm text-muted-foreground" data-testid="hub-result-count">
                {results.length} of {documentCount} document{documentCount === 1 ? "" : "s"}
              </span>
            </div>
            {results.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {results.map((result) => <SearchResult key={result.id} result={result} onOpen={openResult} />)}
              </div>
            ) : (
              <EmptySearchState
                query={query.trim()}
                suggestions={nearMisses}
                onOpenSuggestion={(suggestion) => openDocument({ ...suggestion, kind: "guide", id: suggestion.slug })}
                onAsk={askCopilot}
                asking={false}
                onClear={clearSearch}
                categoryHint="Nexus found no document whose words all appear together."
              />
            )}
          </section>
        )
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {(jumpBackIn.length || recentlyOpenedGuides.length) ? (
            <section className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.05] p-3 xl:col-span-2" aria-label="Continue where you left off">
              <header className="flex items-center gap-2 px-2 pb-2">
                <History className="h-4 w-4 text-amber-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Jump back in</p>
              </header>
              <div className="grid gap-1 sm:grid-cols-2">
                {[...recentlyOpenedGuides, ...jumpBackIn].slice(0, 6).map((document) => (
                  <CompactRow
                    key={`${document.kind}-${document.id}`}
                    document={document}
                    meta={`${document.kind === "guide" ? "Guide" : "Article"} · ${document.category ? (document.kind === "guide" ? document.category : categoryLabel(document.category)) : "Uncategorised"}`}
                    extra={<UseCountBadge count={knowledgeCount(learning, document.kind, document.id)} />}
                    onOpen={() => openDocument(document)}
                  />
                ))}
              </div>
              <KnowledgeMemoryBar summary={memoryHint} onForget={forgetLearning} forgetting={forgetting} />
            </section>
          ) : (
            <section className="rounded-2xl border border-border/70 bg-card/70 p-4 xl:col-span-2" aria-label="Where to start">
              <header className="flex items-center gap-2 pb-2">
                <Compass className="h-4 w-4 text-sky-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">Start here</p>
              </header>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Search above for the task in front of you, or open the tabs below: the <strong className="text-foreground">Help Centre</strong> holds task-first
                guides with verification and rollback steps, and the <strong className="text-foreground">Knowledge Base</strong> holds your team's own runbooks,
                client notes and Hudu imports. Nexus starts ordering these around what you and your team actually read as soon as there is real evidence.
              </p>
              {memoryHint ? <KnowledgeMemoryBar summary={memoryHint} onForget={forgetLearning} forgetting={forgetting} /> : null}
            </section>
          )}

          <section className="rounded-2xl border border-border/70 bg-card/70 p-3" aria-label="Popular documents">
            <header className="flex items-center gap-2 px-2 pb-1">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Most used by the team</p>
            </header>
            {loading ? <KnowledgeLoading label="Loading" /> : (
              <div className="space-y-0.5">
                {popular.length ? popular.map((document) => (
                  <CompactRow
                    key={`popular-${document.kind}-${document.id}`}
                    document={document}
                    meta={`${(document.views || 0)} views · ${readingMinutes(document.body_md || document.content)} min read`}
                    onOpen={() => openDocument(document)}
                  />
                )) : <p className="p-2 text-xs text-muted-foreground">No documents yet. Create the first guide or article and it will appear here.</p>}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/70 p-3 xl:col-span-2" aria-label="Recently updated documents">
            <header className="flex items-center gap-2 px-2 pb-1">
              <Clock className="h-4 w-4 text-violet-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">Recently updated</p>
            </header>
            {loading ? <KnowledgeLoading label="Loading" /> : (
              <div className="grid gap-1 sm:grid-cols-2">
                {recentlyUpdated.length ? recentlyUpdated.map((document) => (
                  <CompactRow
                    key={`recent-${document.kind}-${document.id}`}
                    document={document}
                    meta={`${document.kind === "guide" ? "Guide" : "Article"} · updated ${String(documentUpdatedAt(document)).slice(0, 10) || "unknown"}`}
                    onOpen={() => openDocument(document)}
                  />
                )) : <p className="p-2 text-xs text-muted-foreground">Nothing has been updated yet.</p>}
              </div>
            )}
          </section>
        </div>
      )}

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-1.5">
          {DOC_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="shrink-0 gap-1.5 px-3 py-2 text-xs">
              <Icon className="h-3.5 w-3.5" />{label}
            </TabsTrigger>
          ))}
        </TabsList>
        {DOC_TABS.map(({ value, component: Component }) => (
          <TabsContent key={value} value={value} className="mt-5">
            <EmbeddedWorkspace><Component /></EmbeddedWorkspace>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
