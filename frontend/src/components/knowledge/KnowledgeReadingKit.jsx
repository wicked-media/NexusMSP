/**
 * Reading chrome shared by the Knowledge library and the Help Centre.
 *
 * Both surfaces answer the same question — "where am I in this guide, and how do
 * I know it answered the thing I came for" — so the answer lives in one place
 * instead of two slightly different ones. Everything here is presentational: it
 * states what it knows and never infers a permission or a result.
 *
 * The reading position is measured from the rendered article's own geometry
 * rather than from a chosen scroll container, because this page is rendered both
 * standalone and embedded inside the Documentation Hub, where the scrolling
 * element is not owned by this component.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Check, CheckCircle2, CircleHelp, Copy, FileText, History,
  Lightbulb, Link2, ListTree, Loader2, Printer, Search, Sparkles, ThumbsDown, ThumbsUp,
} from "lucide-react";
import { MATCH_FIELD_LABEL } from "./knowledgeSearch";

/** Distance from the top of the viewport that counts as "currently reading". */
const READING_LINE = 170;

/**
 * Track reading progress and the heading the reader is currently in.
 *
 * The listener is registered on `document` in the capture phase: a `scroll` event
 * does not bubble, but capture reaches an inner scrolling element, so one
 * listener stays correct whether the page scrolls at the window or inside a
 * panel. `headings` must be memoised by the caller, or this re-measures on every
 * render.
 */
export function useReadingState({ contentRef, headings = [] }) {
  const [state, setState] = useState({ progress: 0, activeId: headings[0]?.id || "" });

  useEffect(() => {
    const measure = () => {
      const node = contentRef?.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 800;
      const total = Math.max(1, rect.height);
      const readable = Math.max(1, total - Math.min(viewport * 0.55, total));
      const progress = Math.min(1, Math.max(0, -rect.top) / readable);
      let activeId = headings[0]?.id || "";
      headings.forEach((heading) => {
        if (heading.level > 3) return;
        const target = document.getElementById(heading.id);
        if (target && target.getBoundingClientRect().top <= READING_LINE) activeId = heading.id;
      });
      setState((current) => (
        current.activeId === activeId && Math.abs(current.progress - progress) < 0.004
          ? current
          : { progress, activeId }
      ));
    };
    measure();
    document.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [contentRef, headings]);

  return state;
}

/** A hairline progress bar pinned to the top of the article shell. */
export function ReadingProgress({ progress }) {
  const percentage = Math.round(Math.min(1, Math.max(0, progress || 0)) * 100);
  return (
    <div
      className="nx-reading-progress"
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      data-testid="knowledge-reading-progress"
    >
      <span className="nx-reading-progress__bar" style={{ width: `${percentage}%` }} />
    </div>
  );
}

/**
 * The article's own contents.
 *
 * Renders nothing when a document has no usable headings — an empty "On this
 * page" rail is worse than no rail.
 */
export function TableOfContents({ headings, activeId, onNavigate, title = "On this page" }) {
  const visible = (headings || []).filter((heading) => heading.label && heading.level <= 4);
  if (!visible.length) return null;
  return (
    <nav className="nx-guide-toc" aria-label={title} data-testid="knowledge-toc">
      <p className="nx-guide-toc__title"><ListTree className="h-3.5 w-3.5" />{title}</p>
      <ol className="nx-guide-toc__list">
        {visible.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? "nx-guide-toc__item--nested" : undefined}>
            <a
              href={`#${heading.id}`}
              className={`nx-guide-toc__link${activeId === heading.id ? " is-active" : ""}`}
              aria-current={activeId === heading.id ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(heading.id);
                if (!target) return;
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                // The anchor is written back so the position survives a reload or
                // a copy-paste of the address bar.
                if (window.history?.replaceState) window.history.replaceState(null, "", `#${heading.id}`);
                onNavigate?.(heading);
              }}
            >
              {heading.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Where this document came from: who wrote it, when, and how long it takes. */
export function ArticleProvenance({ author, updatedAt, createdAt, readingMinutes, views, helpfulCount, extra }) {
  const relative = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatDistanceToNow(parsed, { addSuffix: true });
  };
  const updated = relative(updatedAt);
  const created = relative(createdAt);
  return (
    <dl className="nx-guide-provenance" data-testid="knowledge-provenance">
      {author ? <div><dt>Maintained by</dt><dd>{author}</dd></div> : null}
      {updated ? <div><dt>Updated</dt><dd>{updated}</dd></div> : created ? <div><dt>Created</dt><dd>{created}</dd></div> : null}
      {readingMinutes ? <div><dt>Reading time</dt><dd>{readingMinutes} min</dd></div> : null}
      {typeof views === "number" ? <div><dt>Views</dt><dd>{views}</dd></div> : null}
      {typeof helpfulCount === "number" ? <div><dt>Marked helpful</dt><dd>{helpfulCount}</dd></div> : null}
      {extra ? <div><dt>{extra.label}</dt><dd>{extra.value}</dd></div> : null}
    </dl>
  );
}

/** The evidence behind a search result, in the technician's own words. */
export function MatchEvidence({ matched = [], snippet, className = "" }) {
  const fields = useMemo(() => {
    const seen = new Set();
    matched.forEach((entry) => (entry.fields || []).forEach((field) => seen.add(field)));
    return [...seen].map((field) => MATCH_FIELD_LABEL[field] || field);
  }, [matched]);
  if (!fields.length && !snippet) return null;
  return (
    <div className={`space-y-1 ${className}`} data-testid="knowledge-match-evidence">
      {fields.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Search className="h-3 w-3" aria-hidden="true" />
          <span>Matched in</span>
          {fields.map((field) => (
            <Badge key={field} variant="outline" className="rounded-full border-border/70 bg-background/40 px-1.5 py-0 text-[10px] font-medium">
              {field}
            </Badge>
          ))}
        </p>
      ) : null}
      {snippet ? <HighlightedText className="text-xs leading-5 text-muted-foreground" text={snippet} tokens={matched.map((entry) => entry.term)} /> : null}
    </div>
  );
}

/** Highlight the query terms inside a plain-text snippet, without innerHTML. */
export function HighlightedText({ text, tokens = [], className = "" }) {
  const runs = useMemo(() => {
    const source = String(text || "");
    const terms = [...new Set((tokens || []).filter(Boolean))].sort((left, right) => right.length - left.length);
    if (!terms.length || !source) return [{ text: source, hit: false }];
    const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return source.split(pattern).filter(Boolean).map((part) => ({
      text: part,
      hit: terms.some((term) => term.toLowerCase() === part.toLowerCase()),
    }));
  }, [text, tokens]);
  return (
    <p className={className}>
      {runs.map((run, index) => (run.hit
        ? <mark key={`hit-${index}`} className="rounded bg-amber-400/20 px-0.5 text-amber-100">{run.text}</mark>
        : <span key={`run-${index}`}>{run.text}</span>))}
    </p>
  );
}

/** Copy a link to this document, reporting honestly if the browser refuses. */
export function CopyLinkButton({ label = "Copy link", className = "rounded-xl" }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the address bar still has the link.
      toast.error("Nexus could not copy to the clipboard. Copy the address bar instead.");
    }
  }, []);
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={copy} data-testid="knowledge-copy-link">
      {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}{copied ? "Copied" : label}
    </Button>
  );
}

/** Print the document itself, not the workspace around it. */
export function PrintGuideButton({ className = "rounded-xl" }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => window.print()}
      data-testid="knowledge-print"
    >
      <Printer className="mr-1 h-4 w-4" />Print
    </Button>
  );
}

/**
 * "Did this answer it?" for a knowledge article.
 *
 * Both answers are recorded through the existing vote endpoint, and the copy
 * says plainly where the answer goes, so the Technician is never guessing what a
 * vote did.
 */
export function ArticleFeedback({ vote, helpfulCount = 0, onVote, disabledReason, voting }) {
  return (
    <div className="nx-guide-feedback" data-testid="knowledge-feedback">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Did this article answer it?</p>
        <p className="text-xs text-muted-foreground">
          {disabledReason || "Your answer is recorded against this article and improves what Nexus recommends next."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {typeof helpfulCount === "number" ? <Badge variant="outline" className="rounded-full border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200">{helpfulCount} helpful</Badge> : null}
        <Button
          type="button"
          size="sm"
          variant={vote === "up" ? "default" : "outline"}
          className="rounded-xl"
          disabled={Boolean(disabledReason) || voting || vote === "up"}
          onClick={() => onVote?.(true)}
          data-testid="knowledge-vote-helpful"
        >
          {voting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ThumbsUp className="mr-1 h-4 w-4" />}Yes
        </Button>
        <Button
          type="button"
          size="sm"
          variant={vote === "down" ? "secondary" : "outline"}
          className="rounded-xl"
          disabled={Boolean(disabledReason) || voting || vote === "down"}
          onClick={() => onVote?.(false)}
          data-testid="knowledge-vote-not-helpful"
        >
          <ThumbsDown className="mr-1 h-4 w-4" />Not quite
        </Button>
      </div>
    </div>
  );
}

/** The assistant's answer, with the articles it came from — or an honest caveat. */
export function CopilotAnswer({ answer, grounded = true, sources = [] }) {
  if (!answer) return null;
  return (
    <div className="space-y-2" data-testid="knowledge-copilot-answer">
      <div className={`whitespace-pre-wrap rounded-xl border p-3 text-xs leading-5 ${grounded ? "border-cyan-400/18 bg-black/20 text-muted-foreground" : "border-amber-400/25 bg-amber-500/[0.07] text-amber-100"}`}>
        {answer}
      </div>
      {!grounded ? (
        <p className="text-[11px] leading-5 text-amber-200">
          This answer is <strong>not</strong> grounded in a NexusMSP article, so treat it as a starting point and verify it
          against the live workspace before you change anything.
        </p>
      ) : null}
      {grounded && sources.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3" aria-hidden="true" />Based on
          {sources.map((source) => (
            <Badge key={source} variant="outline" className="rounded-full border-border/70 bg-background/40 text-[10px] font-normal">{source}</Badge>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The end of a search that found nothing.
 *
 * A dead end is a wasted trip: this offers the co-pilot, the closest guides by
 * category, and a one-tap way back to everything.
 */
export function EmptySearchState({ query, suggestions = [], onOpenSuggestion, onAsk, asking, onClear, categoryHint }) {
  return (
    <div className="nx-knowledge-empty" data-testid="knowledge-no-results">
      <span className="nx-knowledge-empty__icon"><Search className="h-5 w-5" /></span>
      <p className="text-sm font-semibold text-foreground">Nothing matched “{query}” yet</p>
      <p className="max-w-lg text-xs leading-5 text-muted-foreground">
        {categoryHint
          ? `${categoryHint} Nexus searched titles, summaries, tags and article content.`
          : "Nexus searched titles, summaries, tags and article content. Try a broader word, or ask the co-pilot to point you at the right guide."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onAsk ? (
          <Button type="button" size="sm" className="rounded-xl bg-cyan-400 text-cyan-950 hover:bg-cyan-300" disabled={asking} onClick={onAsk}>
            {asking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Ask the co-pilot
          </Button>
        ) : null}
        {onClear ? <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={onClear}>Clear search</Button> : null}
      </div>
      {suggestions.length ? (
        <div className="mt-1 w-full max-w-2xl">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Closest guides</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => onOpenSuggestion?.(suggestion)}
                className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 p-2.5 text-left transition hover:border-emerald-400/30 hover:bg-emerald-500/[0.05]"
              >
                <span className="text-lg leading-none">{suggestion.icon || "📘"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{suggestion.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{suggestion.category_label || suggestion.category}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Honest statement of what the ordering is based on, plus a way to clear it.
 *
 * Says whether the order comes from this technician's own reading or from the
 * team's, because those are different claims, and the copy it is handed already
 * states that the memory grants nothing and is forgettable.
 */
export function KnowledgeMemoryBar({ summary, onForget, forgetting }) {
  if (!summary) return null;
  return (
    <div className="nx-knowledge-memory" data-testid="knowledge-memory">
      <Lightbulb className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[11px] leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">{summary.label}. </span>{summary.detail}
      </p>
      {onForget ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
          disabled={forgetting}
          onClick={onForget}
          data-testid="knowledge-forget-memory"
        >
          {forgetting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <History className="mr-1 h-3 w-3" />}Forget
        </Button>
      ) : null}
    </div>
  );
}

/** A short list of documents worth a technician's next click. */
export function RelatedList({ items, onOpen, title, hint, emptyLabel, idOf, icon, metaOf, testIdOf }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <section className="rounded-2xl border border-border/70 bg-card/80" aria-label={title}>
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08]">
          <Link2 className="h-4 w-4 text-violet-300" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
      </header>
      <div className="space-y-1 p-2">
        {list.length ? list.map((item) => (
          <button
            key={idOf ? idOf(item) : item.id}
            type="button"
            data-testid={testIdOf ? testIdOf(item) : undefined}
            onClick={() => onOpen?.(item)}
            className="flex w-full items-start gap-2 rounded-xl p-2 text-left transition hover:bg-violet-400/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            {icon ? icon(item) : <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">{item.title}</span>
              {metaOf ? <span className="block truncate text-[11px] text-muted-foreground">{metaOf(item)}</span> : null}
            </span>
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )) : <p className="p-2 text-xs text-muted-foreground">{emptyLabel || "Nothing related yet."}</p>}
      </div>
    </section>
  );
}

/** The one-line "this is a draft" marker every generated body must carry. */
export function DraftNotice({ children, action, onAction }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-5 text-amber-100" data-testid="knowledge-draft-notice">
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {action && onAction ? <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-[11px]" onClick={onAction}>{action}</Button> : null}
    </div>
  );
}

/** A compact, reusable loading/empty pair so both tabs behave the same way. */
export function KnowledgeLoading({ label = "Loading knowledge" }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground" role="status" data-testid="knowledge-loading">
      <Loader2 className="h-5 w-5 animate-spin text-sky-300" />{label}
    </div>
  );
}

export function KnowledgeEmpty({ icon: Icon = CircleHelp, title, description, action, testId }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 p-10 text-center" data-testid={testId}>
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

/** Small "opened N times" affordance so the learned order is never mysterious. */
export function UseCountBadge({ count }) {
  if (!count) return null;
  return (
    <Badge variant="outline" className="gap-1 rounded-full border-amber-400/25 bg-amber-500/[0.07] text-[10px] font-normal text-amber-100">
      <CheckCircle2 className="h-2.5 w-2.5" />opened {count}×
    </Badge>
  );
}
