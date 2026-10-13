import {
  agingTone,
  briefingPack,
  buildExecutiveSearchIndex,
  concentrationLabel,
  concentrationTone,
  executivePeriodLabel,
  groupSearchResults,
  mrrTargetBarPct,
  mrrTargetGrowth,
  mrrTargetGrowthClause,
  mrrTargetStatus,
  mrrTargetSummary,
  overdueShare,
  qualityTone,
  renewalLabel,
  renewalTone,
  searchExecutiveRecords,
  trendBars,
  trendDelta,
} from "./executiveBriefing";

const trend = {
  state: "verified",
  months: [
    { key: "2026-06", label: "Jun 2026", invoiced: 0, collected: 0, count: 0 },
    { key: "2026-07", label: "Jul 2026", invoiced: 8000, collected: 4000, count: 3 },
    { key: "2026-08", label: "Aug 2026", invoiced: 12000, collected: 9000, count: 4 },
  ],
};

describe("executive briefing helpers", () => {
  test("bands ageing tone by age, not by value", () => {
    expect(agingTone({ key: "overdue_90_plus", overdue: true })).toBe("rose");
    expect(agingTone({ key: "overdue_1_30", overdue: true })).toBe("sky");
    expect(agingTone({ key: "not_due", overdue: false })).toBe("emerald");
    expect(agingTone({ key: "undated", overdue: false })).toBe("zinc");
    expect(agingTone(null)).toBe("zinc");
  });

  test("labels concentration from the level the API decided", () => {
    expect(concentrationLabel("dependency")).toBe("Single-client dependency");
    expect(concentrationTone("dependency")).toBe("rose");
    expect(concentrationTone("spread")).toBe("emerald");
    expect(concentrationLabel("something-new")).toBe("Not measurable");
    expect(concentrationTone("something-new")).toBe("zinc");
  });

  test("labels the recorded goal's state and caps the bar without capping the figure", () => {
    expect(mrrTargetStatus("in_progress").label).toBe("In progress");
    expect(mrrTargetStatus("achieved").tone).toBe("emerald");
    expect(mrrTargetStatus("overdue").tone).toBe("rose");
    // An unrecognised state is treated as "no goal", never as progress.
    expect(mrrTargetStatus("something-new").label).toBe("No goal recorded");

    expect(mrrTargetBarPct({ state: "in_progress", progress_pct: 140 })).toBe(100);
    expect(mrrTargetBarPct({ state: "achieved", progress_pct: 112.5 })).toBe(100);
    expect(mrrTargetBarPct({ state: "not_recorded", progress_pct: null })).toBe(0);
    expect(mrrTargetBarPct(null)).toBe(0);
  });

  test("states the goal and its distance, or nothing at all when none is recorded", () => {
    expect(mrrTargetSummary(null)).toBeNull();
    expect(mrrTargetSummary({ state: "not_recorded", target_mrr: null })).toBeNull();

    const inProgress = mrrTargetSummary({
      state: "in_progress",
      target_mrr: 60000,
      target_month_label: "Feb 2027",
      progress_pct: 75,
      gap: 15000,
      months_remaining: 6,
      required_monthly_growth: 2500,
    });
    expect(inProgress).toContain("Recorded MRR goal: $60,000 by Feb 2027");
    expect(inProgress).toContain("contract-backed MRR is 75% of it");
    expect(inProgress).toContain("required step $2,500/month over 6 months");

    const achieved = mrrTargetSummary({ state: "achieved", target_mrr: 40000, progress_pct: 112.5, gap: -5000 });
    expect(achieved).toContain("goal met, surplus $5,000");
    // No target month means no pace is invented.
    expect(mrrTargetSummary({ state: "in_progress", target_mrr: 60000, progress_pct: 50, gap: 30000 }))
      .toContain("no target month recorded, so no pace is stated");
    expect(mrrTargetSummary({
      state: "overdue", target_mrr: 60000, target_month_label: "Jun 2026", progress_pct: 75, gap: 15000, months_remaining: -2,
    })).toContain("the target month has passed");
  });

  test("states growth from the run rate recorded with the goal", () => {
    const growth = mrrTargetGrowth({
      state: "in_progress", starting_mrr: 38900, current_mrr: 45000, growth: 6100, growth_pct: 15.7,
    });
    expect(growth).toEqual({ starting: 38900, growth: 6100, pct: 15.7, direction: "up", recordedAt: null });

    // A fall is a fall: the helper never reports a negative movement as growth.
    expect(mrrTargetGrowth({ state: "in_progress", starting_mrr: 50000, growth: -2500, growth_pct: -5 }))
      .toMatchObject({ direction: "down" });

    // No starting line means no growth is stated, never growth from $0.
    expect(mrrTargetGrowth({ state: "in_progress", starting_mrr: null, growth: null })).toBeNull();
    expect(mrrTargetGrowth({ state: "not_recorded" })).toBeNull();
    expect(mrrTargetGrowth(null)).toBeNull();
  });

  test("says growth is not stated when the goal carries no starting run rate", () => {
    const withLine = mrrTargetSummary({
      state: "in_progress", target_mrr: 60000, progress_pct: 75, gap: 15000,
      starting_mrr: 38900, current_mrr: 45000, growth: 6100, growth_pct: 15.7,
    });
    expect(withLine).toContain("growth of $6,100 (+15.7%) from the $38,900 run rate recorded with the goal");

    const withoutLine = mrrTargetSummary({ state: "in_progress", target_mrr: 60000, progress_pct: 75, gap: 15000 });
    expect(withoutLine).toContain("no starting run rate was recorded with the goal, so growth is not stated");
    expect(withoutLine).not.toContain("$0 starting run rate");

    const falling = mrrTargetSummary({
      state: "in_progress", target_mrr: 60000, progress_pct: 75, gap: 15000,
      starting_mrr: 50000, current_mrr: 45000, growth: -5000, growth_pct: -10,
    });
    expect(falling).toContain("a fall of $5,000 (-10%) from the $50,000 run rate recorded with the goal");

    // A flat run rate is unchanged, never "growth of $0".
    const flat = mrrTargetGrowthClause({
      state: "in_progress", starting_mrr: 38900, current_mrr: 38900, growth: 0, growth_pct: 0,
    });
    expect(flat).toBe("no change from the $38,900 run rate recorded with the goal");
    expect(mrrTargetGrowthClause({ state: "in_progress", starting_mrr: null, growth: null })).toBeNull();
  });

  test("labels renewal urgency and evidence confidence without claiming more than returned", () => {
    expect(renewalLabel("immediate")).toBe("Act now");
    expect(renewalTone("soon")).toBe("amber");
    expect(renewalLabel()).toBe("Scheduled");
    expect(qualityTone("partial")).toBe("amber");
    expect(qualityTone("unexpected")).toBe("zinc");
  });

  test("marks a month with no invoice records as a gap rather than zero revenue", () => {
    const bars = trendBars(trend);
    expect(bars[0].recorded).toBe(false);
    expect(bars[0].invoicedPct).toBe(0);
    expect(bars[2].invoicedPct).toBe(100);
    expect(bars[2].collectedPct).toBe(75);
  });

  test("refuses a trend from a single recorded month", () => {
    expect(trendDelta(trend)?.change).toBe(4000);
    expect(trendDelta({
      months: [
        { key: "2026-07", label: "Jul 2026", invoiced: 8000, collected: 0, count: 0 },
        { key: "2026-08", label: "Aug 2026", invoiced: 12000, collected: 0, count: 4 },
      ],
    })).toBeNull();
    expect(trendDelta(undefined)).toBeNull();
  });

  test("reports the overdue share of the ledger, or nothing when the ledger is empty", () => {
    expect(overdueShare({ outstanding_total: 2000, overdue_total: 500 })).toBe(25);
    expect(overdueShare({ outstanding_total: 0, overdue_total: 0 })).toBeNull();
    expect(overdueShare(null)).toBeNull();
  });

  test("searches the loaded briefing by label first and never returns anything for an empty query", () => {
    const index = buildExecutiveSearchIndex({
      portfolio: [
        { client_id: "a", client_name: "Anchor Freight", health_score: 42, tickets_30d: 9, route: "/clients?client=a" },
        { client_id: "b", client_name: "Beacon Legal", health_score: null, evidence_coverage_pct: 20, tickets_30d: 0, route: "/clients?client=b" },
      ],
      watchlist: [{ client_id: "b", client_name: "Beacon Legal", note: "Renewal risk" }],
      risks: [{ id: "overdue-receivables", severity: "critical", title: "$4,000 is overdue", decision: "Assign collection ownership", route: "/invoices" }],
      renewals: [{ contract_id: "c1", client_id: "a", client_name: "Anchor Freight", days_until: 12, end_date: "2026-09-01", route: "/clients?client=a" }],
      workspaces: [{ label: "Revenue forecast", detail: "Modelled pipeline", route: "/revenue-forecast", keywords: "forecast pipeline" }],
    });

    expect(searchExecutiveRecords(index, "")).toEqual([]);

    const clientHits = searchExecutiveRecords(index, "anchor");
    expect(clientHits[0].label).toBe("Anchor Freight");

    const decisionHits = searchExecutiveRecords(index, "collection");
    expect(decisionHits[0].kind).toBe("decision");

    const workspaceHits = searchExecutiveRecords(index, "pipeline");
    expect(workspaceHits[0].route).toBe("/revenue-forecast");

    expect(searchExecutiveRecords(index, "zzz")).toEqual([]);
    expect(searchExecutiveRecords(index, "renewal").map((entry) => entry.kind)).toContain("renewal");
  });

  test("groups ranked results by kind and marks watched clients on the index", () => {
    const index = buildExecutiveSearchIndex({
      portfolio: [{ client_id: "b", client_name: "Beacon Legal", route: "/clients?client=b" }],
      watchlist: [{ client_id: "b", client_name: "Beacon Legal" }],
    });
    expect(index[0].watched).toBe(true);
    expect(index[1].watched).toBe(true);

    const groups = groupSearchResults(searchExecutiveRecords(index, "beacon"));
    expect(groups.map((group) => group.kind)).toEqual(["client", "watchlist"]);
    expect(groups[0].label).toBe("Client");
    expect(groups[0].entries).toHaveLength(1);
  });

  test("builds a printable pack that states an evidence gap instead of a zero", () => {
    const pack = briefingPack({
      generated_at: "2026-08-20T00:00:00+00:00",
      period: { label: "Trailing 90 days" },
      summary: {
        mrr: 40000,
        arr: 480000,
        service_contribution: null,
        net_cash_30d: -2000,
        average_client_health: null,
        assessed_clients: 0,
        total_clients: 6,
        staff_capacity_pct: null,
      },
      concentration: { detail: "Anchor is 44.0% of contract-backed MRR." },
      receivables: { oldest_overdue_days: 172 },
      mrr_target: {
        state: "in_progress",
        target_mrr: 60000,
        target_month_label: "Feb 2027",
        progress_pct: 66.7,
        gap: 20000,
        months_remaining: 6,
        required_monthly_growth: 3333.34,
        starting_mrr: 30000,
        current_mrr: 40000,
        growth: 10000,
        growth_pct: 33.3,
      },
      risk_items: [{ severity: "high", title: "Aged debt", decision: "Escalate the plan" }],
      data_quality: [{ label: "Direct cost coverage", state: "missing", detail: "No cost records." }],
      board_brief: { headline: "One critical decision.", method: "Deterministic briefing." },
    });

    const text = pack.lines.join("\n");
    expect(pack.title).toBe("Executive briefing · Trailing 90 days");
    expect(text).toContain("Service contribution: not assessed — direct costs are not recorded");
    expect(text).toContain("Average assessed client health: not assessed");
    expect(text).toContain("Oldest overdue invoice: 172 days");
    expect(text).toContain("RECORDED GOAL");
    expect(text).toContain("Recorded MRR goal: $60,000 by Feb 2027");
    expect(text).toContain("growth of $10,000 (+33.3%) from the $30,000 run rate recorded with the goal");
    expect(text).toContain("[high] Aged debt → Escalate the plan");
    expect(text).toContain("Deterministic briefing.");
  });

  test("prints the absence of a goal rather than a zero-valued one", () => {
    const pack = briefingPack({
      generated_at: "2026-08-20T00:00:00+00:00",
      period: { label: "Trailing 30 days" },
      summary: { mrr: 40000, arr: 480000 },
      mrr_target: { state: "not_recorded", target_mrr: null, progress_pct: null },
    });
    const text = pack.lines.join("\n");
    expect(text).toContain("No revenue goal is recorded, so progress is not measured against one.");
  });

  test("falls back to safe copy when a period label is unknown", () => {
    expect(executivePeriodLabel(90)).toBe("90 days");
    expect(executivePeriodLabel(45)).toBe("45 days");
  });
});
