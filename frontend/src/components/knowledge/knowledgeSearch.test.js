/**
 * The knowledge workspace's ranking is presented to technicians as an
 * explanation ("matched in title, content"), so these tests pin the two things
 * that claim depends on: every word must match, and the stated reason must be
 * the field that actually matched.
 *
 * Learned ordering is a separate concern with its own module and its own tests
 * (knowledgeLearning.test.js), because it is no longer a value this page owns.
 */

import {
  KB_CATEGORIES, buildSnippet, categoryLabel, categoryStyle, guideActionFor,
  headingsFromHtml, headingsFromMarkdown, matchDocument, pickPopular, pickRecentlyUpdated,
  queryTokens, readingMinutes, searchDocuments, withHeadingAnchors,
} from "./knowledgeSearch";

const guide = (overrides = {}) => ({
  id: "ticket-triage",
  slug: "ticket-triage",
  title: "Ticket triage",
  summary: "Create a complete service record for a new request.",
  category: "Service desk",
  tags: ["triage", "sla"],
  body_md: "## Outcome\n\nScope the request before you touch anything.\n",
  ...overrides,
});

describe("query handling", () => {
  test("drops filler words and keeps meaningful terms in order", () => {
    expect(queryTokens("How do I receive a purchase order")).toEqual(["receive", "purchase", "order"]);
    expect(queryTokens("")).toEqual([]);
    expect(queryTokens("   ")).toEqual([]);
  });
});

describe("matchDocument", () => {
  test("requires every term, and reports which fields matched", () => {
    const result = matchDocument(guide(), queryTokens("ticket triage"));
    expect(result.score).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
    const fields = result.matched.flatMap((entry) => entry.fields);
    expect(fields).toContain("title");
  });

  test("a term that appears nowhere fails the whole match", () => {
    const result = matchDocument(guide(), queryTokens("ticket mailbox"));
    expect(result.score).toBe(0);
    expect(result.missing).toEqual(["mailbox"]);
    expect(result.matched).toEqual([]);
  });

  test("shorthand in the document is reachable from the long form", () => {
    const document = guide({ title: "PO approval", summary: "Approve a purchase order", tags: [] });
    // "purchase order" in the text expands to "po", which is what a technician types.
    expect(matchDocument(document, queryTokens("po")).score).toBeGreaterThan(0);
  });
});

describe("searchDocuments", () => {
  test("ranks a title match above a body-only match and explains both", () => {
    const documents = [
      guide({ id: "a", slug: "a", title: "Unrelated", summary: "Nothing here", body_md: "winget upgrade notes" }),
      guide({ id: "b", slug: "b", title: "Winget updates", summary: "Pending winget application updates", body_md: "" }),
    ];
    const results = searchDocuments(documents, "winget", { idOf: (document) => document.id });
    expect(results.map((result) => result.id)).toEqual(["b", "a"]);
    expect(results[0].matched[0].term).toBe("winget");
    expect(results[0].snippet.toLowerCase()).toContain("winget");
  });

  test("an empty query returns nothing rather than the whole library", () => {
    expect(searchDocuments([guide()], "")).toEqual([]);
    expect(searchDocuments([guide()], "   ")).toEqual([]);
  });
});

describe("document structure", () => {
  test("adds ids to headings and suffixes duplicates instead of colliding", () => {
    const html = "<h2>Verify</h2><p>x</p><h2>Verify</h2><h3>Deep dive</h3>";
    const anchored = withHeadingAnchors(html);
    expect(anchored).toContain('id="verify"');
    expect(anchored).toContain('id="verify-2"');
    expect(anchored).toContain('id="deep-dive"');
  });

  test("keeps a heading's existing id", () => {
    expect(withHeadingAnchors('<h2 id="custom">Verify</h2>')).toContain('id="custom"');
  });

  test("reads a table of contents from HTML and from Markdown", () => {
    expect(headingsFromHtml("<h2>Outcome</h2><h3>Before you start</h3><h4>Audit</h4>")).toEqual([
      { id: "outcome", label: "Outcome", level: 2 },
      { id: "before-you-start", label: "Before you start", level: 3 },
      { id: "audit", label: "Audit", level: 4 },
    ]);
    expect(headingsFromMarkdown("## Outcome\n\n### Before you start\n")).toEqual([
      { id: "outcome", label: "Outcome", level: 2 },
      { id: "before-you-start", label: "Before you start", level: 3 },
    ]);
  });

  test("estimates reading time from the words actually present", () => {
    expect(readingMinutes("")).toBe(0);
    expect(readingMinutes("word ".repeat(400))).toBe(2);
  });

  test("a snippet is a readable window, not the whole document", () => {
    const snippet = buildSnippet(`${"filler ".repeat(200)} restore the mailbox`, queryTokens("mailbox"), { max: 60 });
    expect(snippet).toContain("mailbox");
    expect(snippet.length).toBeLessThan(90);
  });
});

describe("discovery", () => {
  test("popular and recently updated use the fields the API returns", () => {
    const documents = [
      guide({ id: "quiet", views: 1, helpful_count: 0, created_at: "2026-01-01T00:00:00Z" }),
      guide({ id: "busy", views: 0, helpful_count: 4, created_at: "2026-02-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" }),
    ];
    expect(pickPopular(documents, 1)[0].id).toBe("busy");
    expect(pickRecentlyUpdated(documents, 1)[0].id).toBe("busy");
  });

  test("categories fall back honestly for an unknown value", () => {
    expect(categoryLabel("windows")).toBe("Windows");
    expect(categoryLabel("network_switches")).toBe("Network Switches");
    expect(KB_CATEGORIES.some((category) => category.value === "software")).toBe(true);
    expect(categoryStyle("does-not-exist")).toContain("text-muted-foreground");
  });

  test("only guides with a known workspace get a take-action link", () => {
    expect(guideActionFor("ticket-triage")).toEqual({ path: "/tickets", label: "Open the ticket queue" });
    expect(guideActionFor("some-new-guide")).toBeNull();
  });
});
