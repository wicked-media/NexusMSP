/**
 * Search, structure and discovery helpers for the Knowledge & Help workspace.
 *
 * Everything here is pure: it takes documents the API has already returned and
 * answers questions about them — does this match, *why* did it match, what are
 * its headings, how long does it take to read. Keeping this out of the pages is
 * what makes the ranking explainable: the same tokeniser that decides a match
 * also produces the reason shown to the technician, so Nexus can never claim a
 * result matched for a reason it did not actually check.
 *
 * Nothing here decides what a technician may open. It orders and explains
 * documents the caller already fetched under its own permissions.
 */

/**
 * Knowledge categories. The library was the only place that knew these labels,
 * which meant every surface that showed a category had to invent its own copy;
 * one list keeps the filter, the card badge and the editor consistent.
 */
export const KB_CATEGORIES = Object.freeze([
  { value: "general", label: "General", tone: "text-slate-300 border-slate-400/25 bg-slate-500/10" },
  { value: "windows", label: "Windows", tone: "text-sky-300 border-sky-400/25 bg-sky-500/10" },
  { value: "mac", label: "macOS", tone: "text-zinc-300 border-zinc-400/25 bg-zinc-500/10" },
  { value: "network", label: "Network", tone: "text-emerald-300 border-emerald-400/25 bg-emerald-500/10" },
  { value: "email", label: "Email", tone: "text-violet-300 border-violet-400/25 bg-violet-500/10" },
  { value: "security", label: "Security", tone: "text-rose-300 border-rose-400/25 bg-rose-500/10" },
  { value: "hardware", label: "Hardware", tone: "text-orange-300 border-orange-400/25 bg-orange-500/10" },
  { value: "software", label: "Software", tone: "text-cyan-300 border-cyan-400/25 bg-cyan-500/10" },
  { value: "onboarding", label: "Onboarding", tone: "text-amber-300 border-amber-400/25 bg-amber-500/10" },
  { value: "procedures", label: "Procedures", tone: "text-pink-300 border-pink-400/25 bg-pink-500/10" },
]);

export function categoryLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "General";
  return KB_CATEGORIES.find((category) => category.value === key)?.label
    || String(value).replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function categoryStyle(value) {
  const key = String(value || "").trim().toLowerCase();
  return KB_CATEGORIES.find((category) => category.value === key)?.tone
    || "text-muted-foreground border-border/70 bg-muted/30";
}

/** Words that carry no search meaning on their own. */
const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "how", "do", "i", "is", "it", "of", "in", "on",
  "and", "or", "my", "me", "we", "our", "you", "your", "with", "from", "at", "can",
]);

/**
 * Shorthand technicians actually type, mapped onto the words the guides use.
 * Applied to the document text rather than the query, so one alias entry makes a
 * guide findable by either name instead of needing a synonym list per query.
 */
export const SEARCH_ALIASES = Object.freeze({
  "purchase order": "po",
  "knowledge base": "kb",
  "microsoft 365": "m365 o365",
  "managed asset": "rmm endpoint device",
  "quarterly business review": "qbr",
  "service level": "sla",
  "application update": "winget app patch upgrade",
  "windows update": "patch tuesday servicing",
  "backup": "backup restore recovery immutability",
});

export function normaliseQuery(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Distinct, meaningful search terms, in the order the technician typed them. */
export function queryTokens(value) {
  const seen = new Set();
  normaliseQuery(value)
    .split(/[^a-z0-9.+#-]+/)
    .filter(Boolean)
    .forEach((token) => {
      if (token.length < 2 || STOP_WORDS.has(token)) return;
      seen.add(token);
    });
  return [...seen];
}

export function stripTags(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function expandAliases(text) {
  let result = text;
  Object.entries(SEARCH_ALIASES).forEach(([phrase, shorthand]) => {
    if (result.includes(phrase)) result += ` ${shorthand}`;
  });
  return result;
}

function documentFields(document) {
  const source = document || {};
  const body = source.body_md ?? source.content ?? source.body ?? "";
  return {
    title: normaliseQuery(source.title),
    summary: normaliseQuery(stripTags(source.summary)),
    category: normaliseQuery(source.category),
    slug: normaliseQuery(source.slug || source.id),
    tags: normaliseQuery((source.tags || []).join(" ")),
    body: normaliseQuery(stripTags(body)),
  };
}

const FIELD_WEIGHT = {
  title: 6,
  tags: 4,
  slug: 3,
  summary: 3,
  category: 2,
  body: 1,
};

export const MATCH_FIELD_LABEL = {
  title: "title",
  tags: "tag",
  slug: "address",
  summary: "summary",
  category: "category",
  body: "content",
};

/**
 * Match one document against the query tokens.
 *
 * Every token must appear somewhere, which is what a technician means by a
 * two-word search — matching either word alone would return most of the library.
 * The returned `matched` list is the evidence behind the score: which field
 * matched which word, so the UI can say *why* a result is on screen.
 */
export function matchDocument(document, tokens) {
  const terms = Array.isArray(tokens) ? tokens : queryTokens(tokens);
  if (!terms.length) return { score: 0, matched: [], missing: [] };

  const fields = documentFields(document);
  const expanded = {
    ...fields,
    title: expandAliases(fields.title),
    summary: expandAliases(fields.summary),
    tags: expandAliases(fields.tags),
    body: expandAliases(fields.body),
  };

  let score = 0;
  const matched = [];
  const missing = [];
  terms.forEach((term) => {
    const hits = [];
    Object.keys(FIELD_WEIGHT).forEach((field) => {
      if (!expanded[field] || !expanded[field].includes(term)) return;
      score += FIELD_WEIGHT[field];
      hits.push(field);
    });
    if (hits.length) matched.push({ term, fields: hits });
    else missing.push(term);
  });

  if (missing.length) return { score: 0, matched: [], missing };
  return { score, matched, missing: [] };
}

/** A readable window of the document around the first matched term. */
export function buildSnippet(source, tokens, { max = 190 } = {}) {
  const text = stripTags(source);
  if (!text) return "";
  const terms = (Array.isArray(tokens) ? tokens : queryTokens(tokens)).filter(Boolean);
  const lower = text.toLowerCase();
  let at = -1;
  terms.forEach((term) => {
    const index = lower.indexOf(term);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  });
  if (at < 0) return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  const start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Search documents and explain every result.
 *
 * Returns `{ id, document, score, matched, snippet }` so a caller can key a list,
 * render the document, and show the same evidence that produced the ranking.
 */
export function searchDocuments(documents, query, { limit = 12, idOf } = {}) {
  const list = Array.isArray(documents) ? documents : [];
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const idFor = typeof idOf === "function" ? idOf : (document) => document?.id ?? document?.slug;
  const results = [];
  list.forEach((document, index) => {
    const { score, matched } = matchDocument(document, tokens);
    if (!score) return;
    results.push({
      id: String(idFor(document) ?? index),
      document,
      index,
      score,
      matched,
      snippet: buildSnippet(document?.summary || document?.body_md || document?.content, tokens),
    });
  });
  results.sort((left, right) => right.score - left.score || left.index - right.index);
  return results.slice(0, limit);
}

/** A stable, readable anchor id for a heading. */
export function headingId(text) {
  return normaliseQuery(stripTags(text))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "section";
}

/**
 * Add linkable ids to h2–h4 headings that do not already have one.
 *
 * Duplicate headings on one page are common in runbooks ("Verify", "Rollback"),
 * so repeats are suffixed rather than colliding — a table of contents that jumps
 * to the wrong section is worse than no table of contents.
 */
export function withHeadingAnchors(html) {
  const used = new Map();
  return String(html ?? "").replace(
    /<h([2-4])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, level, attributes, inner) => {
      if (/\bid\s*=/i.test(attributes)) return match;
      const base = headingId(inner);
      const seen = used.get(base) || 0;
      used.set(base, seen + 1);
      const id = seen ? `${base}-${seen + 1}` : base;
      return `<h${level}${attributes} id="${id}">${inner}</h${level}>`;
    },
  );
}

export function headingsFromHtml(html, { levels = [2, 3, 4] } = {}) {
  const wanted = new Set(levels);
  const headings = [];
  const used = new Map();
  String(html ?? "").replace(
    /<h([2-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, level, attributes, inner) => {
      const depth = Number(level);
      if (!wanted.has(depth)) return match;
      const label = stripTags(inner);
      if (!label) return match;
      const declared = /id\s*=\s*["']([^"']+)["']/i.exec(attributes);
      let id = declared ? declared[1] : headingId(label);
      if (!declared) {
        const seen = used.get(id) || 0;
        used.set(id, seen + 1);
        if (seen) id = `${id}-${seen + 1}`;
      }
      headings.push({ id, label, level: depth });
      return match;
    },
  );
  return headings;
}

/** Headings for a Markdown guide body, using the same ids the renderer adds. */
export function headingsFromMarkdown(markdown, { levels = [2, 3, 4] } = {}) {
  const wanted = new Set(levels);
  const headings = [];
  const used = new Map();
  String(markdown ?? "").replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, label) => {
    const depth = hashes.length;
    if (!wanted.has(depth)) return match;
    const text = stripTags(label).replace(/[*_`]/g, "").trim();
    if (!text) return match;
    let id = headingId(text);
    const seen = used.get(id) || 0;
    used.set(id, seen + 1);
    if (seen) id = `${id}-${seen + 1}`;
    headings.push({ id, label: text, level: depth });
    return match;
  });
  return headings;
}

/** Rough reading time, at a deliberately unhurried 200 words per minute. */
export function readingMinutes(source) {
  const words = stripTags(source).split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return Math.max(1, Math.round(words / 200));
}

export function documentUpdatedAt(document) {
  return document?.updated_at || document?.updatedAt || document?.created_at || "";
}

export function pickPopular(documents, limit = 5) {
  return [...(Array.isArray(documents) ? documents : [])]
    .sort((left, right) => popularity(right) - popularity(left))
    .slice(0, limit);
}

function popularity(document) {
  return (Number(document?.views) || 0)
    + (Number(document?.helpful_count) || 0) * 3
    + (Number(document?.helpful_votes) || 0) * 2;
}

export function pickRecentlyUpdated(documents, limit = 5) {
  return [...(Array.isArray(documents) ? documents : [])]
    .filter((document) => documentUpdatedAt(document))
    .sort((left, right) => String(documentUpdatedAt(right)).localeCompare(String(documentUpdatedAt(left))))
    .slice(0, limit);
}

/**
 * The Nexus workspace a guide is about, where one can be named with confidence.
 *
 * This map is deliberately short. Every path here is one the router already
 * serves, because a "take action" button that lands on a 404 is worse than no
 * button: an unmapped guide simply shows none, and the guide body carries the
 * instructions instead.
 */
const GUIDE_ACTIONS = Object.freeze({
  "getting-started": { path: "/nexus-agent", label: "Open the Agent workspace" },
  "ticket-triage": { path: "/tickets", label: "Open the ticket queue" },
  "work-ticket": { path: "/tickets", label: "Open the ticket queue" },
  "nexus-work-session": { path: "/tickets", label: "Open the ticket queue" },
  "client-onboarding": { path: "/clients", label: "Open the client workspace" },
  "client-360": { path: "/clients", label: "Open the client workspace" },
  "managed-assets": { path: "/nexus-agent", label: "Open the Agent workspace" },
  "nexus-shield-and-canary": { path: "/nexus-agent", label: "Open the Agent workspace" },
  "deployment-hub": { path: "/nexus-agent", label: "Open the Agent workspace" },
  "patch-tuesday": { path: "/patch-tuesday", label: "Open Patch Tuesday" },
  "maintenance-windows": { path: "/maintenance-scheduler", label: "Open Maintenance" },
});

export function guideActionFor(slug) {
  const key = normaliseQuery(slug).replace(/\s+/g, "-");
  return GUIDE_ACTIONS[key] || null;
}
