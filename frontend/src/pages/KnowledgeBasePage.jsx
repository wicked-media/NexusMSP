/**
 * Knowledge Base — the team's own runbooks, client notes and Hudu imports.
 *
 * The library keeps every endpoint it had. What changed is the reading
 * experience: an article now has a table of contents, reading position, real
 * provenance, related reading and a vote that says where the answer goes; the
 * search explains *why* each result is on screen; and the order adapts to what
 * this technician actually opens.
 *
 * Search and ordering are presentation only. They reorder documents the page
 * already fetched under the caller's permissions, and they can never reveal an
 * article, grant access or promote an action.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowLeft, BookOpen, Clock, Edit, Eye, FileText, Globe, History, Link2, Loader2, Lock,
  Pin, Plus, RefreshCw, Search, Sparkles, Tag, ThumbsUp, TrendingUp, User,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import HeroTile from "@/components/HeroTile";
import { RichTextEditor } from "@/components/RichTextEditor";
import DOMPurify from "dompurify";
import ConfidenceLens from "@/components/confidence/ConfidenceLens";
import {
  KB_CATEGORIES, categoryLabel, categoryStyle, documentUpdatedAt, headingsFromHtml,
  pickPopular, pickRecentlyUpdated, readingMinutes, searchDocuments, withHeadingAnchors,
} from "@/components/knowledge/knowledgeSearch";
import {
  KNOWLEDGE_KINDS, knowledgeCount, knowledgeHint, rankKnowledge, recentlyRead, rememberKnowledge,
} from "@/components/knowledge/knowledgeLearning";
import { useWorkspaceLearning } from "@/hooks/useWorkspaceLearning";
import { LEARNING_WORKSPACES } from "@/lib/workspaceLearning";
import {
  ArticleFeedback, ArticleProvenance, CopyLinkButton, EmptySearchState, KnowledgeEmpty,
  KnowledgeLoading, KnowledgeMemoryBar, MatchEvidence, PrintGuideButton, ReadingProgress,
  RelatedList, TableOfContents, UseCountBadge, useReadingState,
} from "@/components/knowledge/KnowledgeReadingKit";

const EMPTY_FORM = {
  title: "", summary: "", content: "", category: "general", tags: "",
  is_public: false, is_pinned: false, related_article_ids: [], content_format: "html",
};

function plainText(article) {
  const source = article?.summary || article?.content || "";
  return String(source).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default function KnowledgeBasePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") || "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [viewArticle, setViewArticle] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [huduSyncing, setHuduSyncing] = useState(false);
  const [installingLibrary, setInstallingLibrary] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [voting, setVoting] = useState(false);
  const [vote, setVote] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const contentRef = useRef(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  // The library learns through the shared workspace store, like every other
  // workspace: the server owns the counters and the tenant-wide aggregate.
  const learning = useWorkspaceLearning(token, LEARNING_WORKSPACES.DOCUMENTATION);
  const { record } = learning;

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/kb/articles`, { headers });
      setArticles(Array.isArray(res.data) ? res.data : []);
      setLoadError("");
    } catch {
      setArticles([]);
      setLoadError("Nexus could not reach the knowledge library. Nothing has been changed — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  /**
   * Open an article: record the use, clear any previous vote, and reflect the
   * selection in the URL so a technician can share or reload the exact article.
   */
  const openArticle = useCallback(async (article) => {
    setVote(null);
    setViewArticle(article);
    rememberKnowledge(record, KNOWLEDGE_KINDS.ARTICLE, article.id);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "library");
    next.set("article", String(article.id));
    setSearchParams(next, { replace: true });
    // The record's own view counter is advanced by the detail endpoint, which is
    // also what keeps a deep-linked article readable when it is not in the list.
    try {
      const res = await axios.get(`${API}/kb/articles/${article.id}`, { headers });
      if (res.data && !res.data.error) setViewArticle(res.data);
    } catch {
      // The list copy is already on screen; failing to refresh it changes nothing.
    }
  }, [headers, record, searchParams, setSearchParams]);

  const closeArticle = useCallback(() => {
    setViewArticle(null);
    setVote(null);
    const next = new URLSearchParams(searchParams);
    next.delete("article");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Deep link: /documentation-hub?tab=library&article=<id> opens that article.
  const deepLinkId = searchParams.get("article");
  useEffect(() => {
    if (!deepLinkId || viewArticle?.id === deepLinkId) return;
    const known = articles.find((item) => String(item.id) === String(deepLinkId));
    if (known) { openArticle(known); return; }
    if (!articles.length) return;
    axios.get(`${API}/kb/articles/${deepLinkId}`, { headers })
      .then((res) => { if (res.data && !res.data.error) setViewArticle(res.data); })
      .catch(() => toast.error("That article could not be opened. It may have been deleted."));
  }, [deepLinkId, articles, viewArticle?.id, openArticle, headers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const requested = searchParams.get("q");
    if (requested !== null && requested !== searchQuery) setSearchQuery(requested);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.title.trim()) {
      toast.error("A title is required");
      return;
    }
    const payload = {
      ...formData,
      tags: formData.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    try {
      if (selectedArticle) {
        await axios.put(`${API}/kb/articles/${selectedArticle.id}`, payload, { headers });
        toast.success("Article updated");
      } else {
        await axios.post(`${API}/kb/articles`, payload, { headers });
        toast.success("Article created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchArticles();
    } catch {
      toast.error("Failed to save article");
    }
  };

  const handleHelpful = async (id) => {
    try {
      await axios.post(`${API}/kb/articles/${id}/helpful`, {}, { headers });
      toast.success("Marked as helpful — this raises the article for the rest of the team.");
      fetchArticles();
    } catch { toast.error("Nexus could not record that vote"); }
  };

  /**
   * Record whether the article answered the question. The endpoint accepts a
   * helpful/not-helpful verdict, and the copy on screen says so before the click.
   */
  const handleVote = async (helpful) => {
    if (!viewArticle) return;
    setVoting(true);
    try {
      await axios.post(`${API}/kb/articles/${viewArticle.id}/vote`, { helpful }, { headers });
      setVote(helpful ? "up" : "down");
      toast.success(helpful ? "Thanks — recorded as helpful" : "Recorded — Nexus will rank this lower for you");
      fetchArticles();
    } catch {
      toast.error("Nexus could not record that vote");
    } finally {
      setVoting(false);
    }
  };

  const openEdit = (article) => {
    setSelectedArticle(article);
    setFormData({
      title: article.title, summary: article.summary || "", content: article.content || "",
      category: article.category || "general",
      tags: (article.tags || []).join(", "),
      is_public: article.is_public || false,
      is_pinned: article.is_pinned || false,
      related_article_ids: article.related_article_ids || [],
      content_format: article.content_format || "html",
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setSelectedArticle(null);
  };

  const installTechnicianLibrary = async () => {
    setInstallingLibrary(true);
    try {
      const res = await axios.post(`${API}/kb/articles/install-technician-library`, {}, { headers });
      toast.success(res.data.message || "Technician library installed");
      fetchArticles();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not install the technician library");
    } finally {
      setInstallingLibrary(false);
    }
  };

  const syncFromHudu = async () => {
    setHuduSyncing(true);
    try {
      const res = await axios.post(`${API}/hudu/sync`, {}, { headers });
      toast.success(res.data.message || `Synced ${res.data.synced || 0} articles from Hudu`);
      fetchArticles();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Hudu sync failed. Check Hudu settings in Settings page.");
    } finally {
      setHuduSyncing(false);
    }
  };

  const forgetLearning = async () => {
    setForgetting(true);
    try {
      const removed = await learning.forget();
      toast.success(`Forgot ${removed} learned signal${removed === 1 ? "" : "s"}`, {
        description: "Articles are back in the order Nexus shipped them and will learn again from your next read.",
      });
    } catch {
      toast.error("Nexus could not clear the learned ordering. Nothing has been changed.");
    } finally {
      setForgetting(false);
    }
  };

  const askCopilotAbout = (article) => {
    const next = new URLSearchParams();
    next.set("tab", "help");
    next.set("q", article?.title || searchQuery);
    navigate(`/documentation-hub?${next.toString()}`);
  };

  const searchResults = useMemo(
    () => searchDocuments(articles, searchQuery, { limit: 60 }),
    [articles, searchQuery],
  );

  const filteredArticles = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.map((result) => result.document).filter((article) => {
        const matchCategory = categoryFilter === "all" || article.category === categoryFilter;
        const matchVisibility = visibilityFilter === "all"
          || (visibilityFilter === "public" && article.is_public)
          || (visibilityFilter === "internal" && !article.is_public);
        const matchTab = activeTab === "all"
          || (activeTab === "pinned" && article.is_pinned)
          || (activeTab === "public" && article.is_public);
        return matchCategory && matchVisibility && matchTab;
      });
    }
    const filtered = articles.filter((article) => {
      const matchCategory = categoryFilter === "all" || article.category === categoryFilter;
      const matchVisibility = visibilityFilter === "all"
        || (visibilityFilter === "public" && article.is_public)
        || (visibilityFilter === "internal" && !article.is_public);
      const matchTab = activeTab === "all"
        || (activeTab === "pinned" && article.is_pinned)
        || (activeTab === "public" && article.is_public);
      return matchCategory && matchVisibility && matchTab;
    });
    // Pinned first, then the order Nexus learned from this technician and their
    // team. Pinned is an authored decision, so learning is not allowed to bury it.
    const pinned = filtered.filter((article) => article.is_pinned);
    const rest = filtered.filter((article) => !article.is_pinned);
    return [...pinned, ...rankKnowledge(learning, rest, { kind: KNOWLEDGE_KINDS.ARTICLE, idOf: (article) => article.id })];
  }, [articles, searchQuery, searchResults, categoryFilter, visibilityFilter, activeTab, learning]);

  const evidenceFor = useMemo(() => {
    const map = new Map();
    searchResults.forEach((result) => map.set(String(result.document.id), result));
    return map;
  }, [searchResults]);

  const categoriesInUse = useMemo(() => {
    const counts = new Map();
    articles.forEach((article) => counts.set(article.category, (counts.get(article.category) || 0) + 1));
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count || String(left.value).localeCompare(String(right.value)));
  }, [articles]);

  const pinnedArticles = useMemo(() => articles.filter((article) => article.is_pinned), [articles]);
  const popular = useMemo(() => pickPopular(articles, 5), [articles]);
  const recentlyUpdated = useMemo(() => pickRecentlyUpdated(articles, 5), [articles]);
  const recentlyOpened = useMemo(
    () => recentlyRead(learning, articles, { kind: KNOWLEDGE_KINDS.ARTICLE, idOf: (article) => article.id, limit: 4 }),
    [articles, learning],
  );
  const memoryHint = useMemo(() => knowledgeHint(learning), [learning]);

  const relatedArticles = useMemo(() => {
    if (!viewArticle) return [];
    const others = articles.filter((article) => article.id !== viewArticle.id);
    const sharedTags = (candidate) => (candidate.tags || []).filter((tag) => (viewArticle.tags || []).includes(tag)).length;
    return others
      .map((article) => ({
        article,
        score: (article.category === viewArticle.category ? 2 : 0) + sharedTags(article),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((entry) => entry.article);
  }, [articles, viewArticle]);

  /** Anchored HTML plus the table of contents that matches those exact ids. */
  const readerContent = useMemo(() => {
    if (!viewArticle) return { html: "", headings: [], isHtml: false, text: "" };
    const isHtml = (viewArticle.content_format || "html") === "html";
    if (!isHtml) return { html: "", headings: [], isHtml: false, text: viewArticle.content || "" };
    const anchored = withHeadingAnchors(viewArticle.content || "");
    return {
      html: DOMPurify.sanitize(anchored),
      headings: headingsFromHtml(anchored),
      isHtml: true,
      text: viewArticle.content || "",
    };
  }, [viewArticle]);

  const { progress, activeId } = useReadingState({ contentRef, headings: readerContent.headings });

  if (viewArticle) {
    return (
      <div className="space-y-6" data-testid="kb-article-view">
        <article className="overflow-hidden rounded-[22px] border border-sky-400/20 bg-gradient-to-br from-sky-400/[0.07] via-background to-background shadow-[0_24px_70px_-46px_rgba(56,189,248,0.58)]">
          <ReadingProgress progress={progress} />
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
            <Button variant="ghost" size="sm" className="-ml-1 h-8 text-muted-foreground hover:bg-sky-400/10 hover:text-sky-200" onClick={closeArticle} data-testid="back-to-kb">
              <ArrowLeft className="mr-1 h-4 w-4" />Back to knowledge library
            </Button>
            <span className="text-border">/</span>
            <span className="truncate text-sm font-medium text-muted-foreground">{viewArticle.title}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <CopyLinkButton />
              <PrintGuideButton />
            </span>
          </div>
          <header className="flex flex-col gap-5 px-6 py-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Team knowledge</p>
              <div className="mt-1 flex min-w-0 items-start gap-2">
                {viewArticle.is_pinned ? <Pin className="mt-1 h-4 w-4 shrink-0 text-amber-300" /> : null}
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{viewArticle.title}</h1>
              </div>
              {viewArticle.summary ? <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{viewArticle.summary}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`rounded-full ${categoryStyle(viewArticle.category)}`}>{categoryLabel(viewArticle.category)}</Badge>
                <Badge variant="outline" className="gap-1 rounded-full border-border/70 bg-background/35">
                  {viewArticle.is_public ? <><Globe className="h-3 w-3" />Public</> : <><Lock className="h-3 w-3" />Internal</>}
                </Badge>
                <UseCountBadge count={knowledgeCount(learning, KNOWLEDGE_KINDS.ARTICLE, viewArticle.id)} />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => handleHelpful(viewArticle.id)} data-testid="helpful-btn">
                <ThumbsUp className="mr-1 h-4 w-4" />Helpful
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => askCopilotAbout(viewArticle)} data-testid="kb-ask-copilot">
                <Sparkles className="mr-1 h-4 w-4" />Ask the co-pilot
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => openEdit(viewArticle)}>
                <Edit className="mr-1 h-4 w-4" />Edit
              </Button>
            </div>
          </header>
        </article>

        <ArticleProvenance
          author={viewArticle.author_name || viewArticle.created_by || "Nexus team"}
          updatedAt={documentUpdatedAt(viewArticle)}
          createdAt={viewArticle.created_at}
          readingMinutes={readingMinutes(viewArticle.content)}
          views={viewArticle.views || 0}
          helpfulCount={viewArticle.helpful_count || 0}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,0.34fr)]">
          <div ref={contentRef} className="min-w-0">
            <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
              <CardContent className="p-6">
                {readerContent.isHtml ? (
                  <div className="nx-guide-doc" data-testid="article-content" dangerouslySetInnerHTML={{ __html: readerContent.html }} />
                ) : (
                  <div className="nx-guide-doc whitespace-pre-wrap" data-testid="article-content">{readerContent.text}</div>
                )}
              </CardContent>
            </Card>

            {viewArticle.tags?.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/55 p-3">
                <Tag className="h-4 w-4 text-sky-300" />
                {viewArticle.tags.map((tag) => <Badge key={tag} variant="outline" className="rounded-full border-border/70 bg-background/35 text-xs">{tag}</Badge>)}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><User className="h-3 w-3" />{viewArticle.author_name || viewArticle.created_by || "Nexus team"}</span>
              {viewArticle.created_at ? <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDistanceToNow(new Date(viewArticle.created_at), { addSuffix: true })}</span> : null}
              <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{viewArticle.views || 0} views</span>
            </div>

            <div className="mt-4">
              <ArticleFeedback
                vote={vote}
                helpfulCount={viewArticle.helpful_count || 0}
                voting={voting}
                onVote={handleVote}
              />
            </div>
          </div>

          <aside className="space-y-4">
            <TableOfContents headings={readerContent.headings} activeId={activeId} />
            <ConfidenceLens entityType="documentation" entityId={viewArticle.id} token={token} API={API} variant="compact" className="w-full" />
            <RelatedList
              title="Related reading"
              hint="Same category, then shared tags"
              emptyLabel="No related articles yet. Add tags or a category to link this one up."
              items={relatedArticles}
              idOf={(article) => article.id}
              testIdOf={(article) => `related-${article.id}`}
              metaOf={(article) => categoryLabel(article.category)}
              onOpen={(article) => openArticle(article)}
            />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="knowledge-base-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground">
            {articles.length} article{articles.length === 1 ? "" : "s"} · {pinnedArticles.length} pinned
            {memoryHint ? ` · ${memoryHint.label.toLowerCase()}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={installTechnicianLibrary} disabled={installingLibrary} data-testid="install-technician-library">
            {installingLibrary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}Install technician library
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={syncFromHudu} disabled={huduSyncing} data-testid="hudu-sync-btn">
            {huduSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync from Hudu
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={fetchArticles} data-testid="refresh-kb-toolbar">
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <Button size="sm" className="rounded-xl" onClick={() => setIsDialogOpen(true)} data-testid="create-article-btn">
              <Plus className="mr-2 h-4 w-4" />New Article
            </Button>
            <DialogContent className="flex h-[min(920px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
              <DialogHeader className="shrink-0 border-b border-border/80 bg-gradient-to-r from-sky-400/15 via-sky-400/[0.04] to-transparent px-5 py-5 pr-12">
                <DialogTitle>{selectedArticle ? "Edit knowledge article" : "Create knowledge article"}</DialogTitle>
                <p className="text-sm text-muted-foreground">A structured workspace with rich content, tables, links, screenshots, HTML source, and publication controls.</p>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                  <div className="grid gap-4 md:grid-cols-[1fr_280px]">
                    <div className="space-y-2"><Label>Article title *</Label><Input value={formData.title} onChange={(event) => setFormData({ ...formData, title: event.target.value })} placeholder="How to reset a Windows password" required /></div>
                    <div className="space-y-2"><Label>Tags</Label><Input value={formData.tags} onChange={(event) => setFormData({ ...formData, tags: event.target.value })} placeholder="password, windows, reset" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{KB_CATEGORIES.map((category) => <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Technician summary</Label><Input value={formData.summary} onChange={(event) => setFormData({ ...formData, summary: event.target.value })} placeholder="What this runbook solves and when to use it" /></div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Article content *</Label>
                      <span className="text-xs text-muted-foreground">Paste screenshots, drag images, build tables, or switch to HTML source.</span>
                    </div>
                    <RichTextEditor content={formData.content} onChange={(content) => setFormData((current) => ({ ...current, content, content_format: "html" }))} minHeight="320px" />
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch checked={formData.is_public} onCheckedChange={(value) => setFormData({ ...formData, is_public: value })} />
                      <Label className="flex items-center gap-1">{formData.is_public ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{formData.is_public ? "Public" : "Internal Only"}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={formData.is_pinned} onCheckedChange={(value) => setFormData({ ...formData, is_pinned: value })} />
                      <Label className="flex items-center gap-1"><Pin className="h-4 w-4" />Pin to Top</Label>
                    </div>
                  </div>
                </div>
                <DialogFooter className="shrink-0 border-t border-border/80 bg-muted/[0.12] px-5 py-4">
                  <Button variant="outline" type="button" onClick={() => { setIsDialogOpen(false); resetForm(); }}>Cancel</Button>
                  <Button type="submit">{selectedArticle ? "Update" : "Create Article"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <HeroTile label="Total articles" value={articles.length} icon={BookOpen} glow="sky" />
        <HeroTile label="Pinned" value={pinnedArticles.length} icon={Pin} glow="amber" />
        <HeroTile label="Public" value={articles.filter((article) => article.is_public).length} icon={Globe} glow="emerald" />
        <HeroTile label="Total views" value={articles.reduce((sum, article) => sum + (article.views || 0), 0)} icon={Eye} glow="violet" />
        <HeroTile label="Helpful votes" value={articles.reduce((sum, article) => sum + (article.helpful_count || 0), 0)} icon={ThumbsUp} glow="cyan" />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Knowledge library</p>
          <p className="text-xs text-muted-foreground">Build runbooks with rich text, screenshots, links, tables, and safe HTML source.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={syncFromHudu} disabled={huduSyncing} data-testid="hudu-sync-toolbar">
            {huduSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync Hudu
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={fetchArticles}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={installTechnicianLibrary} disabled={installingLibrary} data-testid="install-technician-library-toolbar">
            {installingLibrary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}Install starter library
          </Button>
          <Button size="sm" className="rounded-xl" onClick={() => setIsDialogOpen(true)} data-testid="create-article-toolbar"><Plus className="mr-2 h-4 w-4" />New article</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search titles, tags, summaries and article content…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
            data-testid="kb-search-input"
            aria-label="Search the knowledge library"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categoriesInUse.map((category) => <SelectItem key={category.value} value={category.value}>{categoryLabel(category.value)} ({category.count})</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <KnowledgeMemoryBar summary={memoryHint} onForget={forgetLearning} forgetting={forgetting} />

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-xs leading-5 text-amber-100" role="status" data-testid="kb-load-error">
          <span className="min-w-0 flex-1">{loadError}</span>
          <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-[11px]" onClick={fetchArticles}>Try again</Button>
        </div>
      ) : null}

      {!searchQuery.trim() && (recentlyOpened.length || recentlyUpdated.length) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {recentlyOpened.length ? (
            <section className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.045] p-3" aria-label="Recently opened by you">
              <header className="flex items-center gap-2 px-2 pb-1">
                <History className="h-4 w-4 text-amber-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Continue reading</p>
              </header>
              {recentlyOpened.map((article) => (
                <button key={`recent-${article.id}`} type="button" onClick={() => openArticle(article)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-amber-500/[0.08]">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1 truncate text-xs">{article.title}</span>
                  <UseCountBadge count={knowledgeCount(learning, KNOWLEDGE_KINDS.ARTICLE, article.id)} />
                </button>
              ))}
            </section>
          ) : null}
          <section className="rounded-2xl border border-border/70 bg-card/60 p-3" aria-label="Most used and recently updated">
            <header className="flex flex-wrap items-center gap-2 px-2 pb-1">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Most used</p>
              <span className="text-border">·</span>
              <Clock className="h-3.5 w-3.5 text-violet-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">Recently updated</p>
            </header>
            <div className="grid gap-0.5 sm:grid-cols-2">
              {[...new Map([...popular, ...recentlyUpdated].map((article) => [article.id, article])).values()].slice(0, 6).map((article) => (
                <button key={`shortcut-${article.id}`} type="button" onClick={() => openArticle(article)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-sky-400/[0.06]">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs">{article.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{article.views || 0} views</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All Articles</TabsTrigger>
          <TabsTrigger value="pinned" className="gap-1"><Pin className="h-3 w-3" />Pinned ({pinnedArticles.length})</TabsTrigger>
          <TabsTrigger value="public" className="gap-1"><Globe className="h-3 w-3" />Public</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="pt-4">
          {loading ? (
            <KnowledgeLoading label="Loading the knowledge library" />
          ) : filteredArticles.length > 0 ? (
            <>
              {searchQuery.trim() ? (
                <p className="mb-3 text-sm text-muted-foreground" data-testid="kb-result-count">
                  {filteredArticles.length} of {articles.length} article{articles.length === 1 ? "" : "s"} match every word in “{searchQuery.trim()}”
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredArticles.map((article) => {
                  const evidence = evidenceFor.get(String(article.id));
                  return (
                    <Card
                      key={article.id}
                      role="button"
                      tabIndex={0}
                      className={`cursor-pointer overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.9)] transition-all hover:-translate-y-0.5 hover:border-sky-400/35 hover:shadow-[0_22px_42px_-34px_rgba(56,189,248,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${article.is_pinned ? "border-amber-400/30" : ""}`}
                      onClick={() => openArticle(article)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openArticle(article); } }}
                      data-testid={`kb-article-${article.id}`}
                    >
                      <CardContent className="p-5">
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {article.is_pinned ? <Pin className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /> : null}
                            <h3 className="line-clamp-2 text-sm font-semibold">{article.title}</h3>
                          </div>
                          <Badge variant="outline" className="ml-2 flex-shrink-0 text-[9px]">
                            {article.is_public ? <Globe className="mr-0.5 h-2.5 w-2.5" /> : <Lock className="mr-0.5 h-2.5 w-2.5" />}
                            {article.is_public ? "Public" : "Internal"}
                          </Badge>
                        </div>
                        <p className="mb-3 line-clamp-3 text-xs text-muted-foreground">{plainText(article).slice(0, 180)}</p>
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={`text-[9px] ${categoryStyle(article.category)}`}>{categoryLabel(article.category)}</Badge>
                          {(article.tags || []).slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>)}
                          <UseCountBadge count={knowledgeCount(learning, KNOWLEDGE_KINDS.ARTICLE, article.id)} />
                        </div>
                        {evidence ? <MatchEvidence className="mb-2" matched={evidence.matched} /> : null}
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{article.views || 0}</span>
                            <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{article.helpful_count || 0}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{readingMinutes(article.content)} min</span>
                          </div>
                          {documentUpdatedAt(article) ? <span>{formatDistanceToNow(new Date(documentUpdatedAt(article)), { addSuffix: true })}</span> : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : searchQuery.trim() ? (
            <EmptySearchState
              query={searchQuery.trim()}
              suggestions={popular.slice(0, 4).map((article) => ({ ...article, category_label: categoryLabel(article.category) }))}
              onOpenSuggestion={(article) => openArticle(article)}
              onAsk={() => askCopilotAbout({ title: searchQuery.trim() })}
              asking={false}
              onClear={() => { setSearchQuery(""); setCategoryFilter("all"); setVisibilityFilter("all"); }}
            />
          ) : articles.length ? (
            <KnowledgeEmpty
              title="No article matches these filters"
              description="Clear the category or visibility filter to see the rest of the library. Nothing has been hidden from you — these are the filters you set."
              testId="kb-filter-empty"
              action={<Button type="button" variant="outline" size="sm" className="mt-3 rounded-xl" onClick={() => { setCategoryFilter("all"); setVisibilityFilter("all"); }}>Clear filters</Button>}
            />
          ) : (
            <KnowledgeEmpty
              icon={BookOpen}
              title="The knowledge library is empty"
              description="Install the Nexus starter library to get the standard runbooks, or write the first article for a job your team repeats."
              testId="kb-empty"
              action={<Button type="button" className="mt-3 rounded-xl" onClick={installTechnicianLibrary} disabled={installingLibrary}>{installingLibrary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}Install technician library</Button>}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
