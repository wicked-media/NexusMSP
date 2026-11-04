import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Radar, ThumbsDown, ThumbsUp } from "lucide-react";
import { frictionEstimateText } from "@/lib/flowIntelligence";

const KIND_LABELS = {
  repeated_navigation: "Repeated navigation",
  concentrated_usage: "One screen for everything",
};

const PROPOSAL_TONES = {
  proposed: "border-amber-500/25 bg-amber-500/[0.07] text-amber-200",
  approved: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-200",
  rejected: "border-white/10 bg-white/[0.03] text-zinc-400",
};

/**
 * Friction Radar — what Nexus's own workflows cost technicians.
 *
 * The evidence is the aggregate usage Nexus already records, so this card reads
 * counts, never people: it never names a technician and never ranks one. Every
 * opportunity is a proposal for human review, and the card says so.
 */
export default function FrictionRadarCard({ headers, onChanged }) {
  const [opportunities, setOpportunities] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [boundary, setBoundary] = useState("");
  const [expanded, setExpanded] = useState("");
  const [solution, setSolution] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/flow-intelligence/friction`, { headers });
      setOpportunities(data.opportunities || []);
      setProposals(data.proposals || []);
      setBoundary(data.boundary || "");
    } catch {
      toast.error("Nexus could not read the workflow friction evidence.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const propose = async (opportunity) => {
    setBusy(true);
    try {
      await axios.post(
        `${API}/flow-intelligence/friction/proposals`,
        {
          opportunity_id: opportunity.id,
          kind: opportunity.kind,
          workspace: opportunity.workspace,
          target: opportunity.target,
          proposed_solution: solution.trim() || opportunity.proposed_solution,
          evidence_note: note.trim(),
        },
        { headers },
      );
      setExpanded("");
      setSolution("");
      setNote("");
      await load();
      onChanged?.();
      toast.success("Friction proposal recorded", { description: "It now waits for a human review before anything changes." });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The proposal could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const review = async (proposal, decision) => {
    if (reviewNote.trim().length < 5) {
      toast.error("Record why this proposal was approved or rejected.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(
        `${API}/flow-intelligence/friction/proposals/${proposal.id}/review`,
        { decision, evidence_note: reviewNote.trim() },
        { headers },
      );
      setReviewing("");
      setReviewNote("");
      await load();
      onChanged?.();
      toast.success(`Proposal ${decision}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The review could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const openFor = (id) => new Set(proposals.filter((row) => row.status === "proposed").map((row) => row.opportunity_id)).has(id);

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.05] via-card to-violet-500/[0.025] p-4" data-testid="friction-radar-card">
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/[0.09]">
          <Radar className="h-4 w-4 text-cyan-200" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">Friction Radar</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Where Nexus's own workflows cost technicians time. Aggregate counts only — no technician is named or ranked.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto border-cyan-500/25 text-[10px] text-cyan-100" data-testid="friction-count">
          {opportunities.length} opportunity{opportunities.length === 1 ? "" : "ies"}
        </Badge>
      </header>

      {loading && <p className="text-[11px] text-muted-foreground">Reading the workflow evidence…</p>}

      {!loading && opportunities.length === 0 && (
        <p className="rounded-lg border border-white/[0.07] bg-black/10 p-3 text-[11px] text-muted-foreground" data-testid="friction-empty">
          Not enough evidence yet. Nexus calls something friction only once it has seen the same steps repeat at least a
          dozen times inside a usable window, and it never invents a saving figure.
        </p>
      )}

      <ul className="space-y-2">
        {opportunities.map((opportunity) => (
          <li key={opportunity.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-3" data-testid={`friction-opportunity-${opportunity.target}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-violet-500/25 text-[10px] text-violet-200">
                {KIND_LABELS[opportunity.kind] || opportunity.kind}
              </Badge>
              <span className="font-mono text-[11px] text-zinc-200">{opportunity.target}</span>
              <span className="text-[10px] text-muted-foreground">
                {opportunity.workspaces?.length > 1 ? `reached from ${opportunity.workspaces.join(", ")}` : `${opportunity.workspace} workspace`}
              </span>
              <span className="ml-auto text-[11px] text-cyan-100">{frictionEstimateText(opportunity)}</span>
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-300">{opportunity.proposed_solution}</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {opportunity.observed_repeats} observed repeat(s) · {opportunity.estimate_reason}
            </p>

            {openFor(opportunity.id) ? (
              <span className="mt-2 inline-block rounded border border-amber-500/25 bg-amber-500/[0.06] px-2 py-0.5 text-[10px] text-amber-200">
                Awaiting review
              </span>
            ) : expanded === opportunity.id ? (
              <div className="mt-2 space-y-2">
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
                  placeholder="What should Nexus change? e.g. Add one contextual remote button to the queue row."
                  value={solution}
                  onChange={(event) => setSolution(event.target.value)}
                  aria-label="Proposed solution"
                  data-testid="friction-solution-input"
                />
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
                  placeholder="What evidence supports it?"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  aria-label="Evidence note"
                  data-testid="friction-note-input"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => propose(opportunity)} disabled={busy} data-testid="friction-propose-submit">Propose fix</Button>
                  <Button size="sm" variant="ghost" onClick={() => setExpanded("")}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="mt-2 border-cyan-500/25 text-cyan-100 hover:bg-cyan-500/[0.08]" onClick={() => { setExpanded(opportunity.id); setSolution(opportunity.proposed_solution); setNote(""); }} data-testid={`friction-propose-${opportunity.target}`}>
                Propose a fix
              </Button>
            )}
          </li>
        ))}
      </ul>

      {proposals.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Proposal review</p>
          <ul className="space-y-2" data-testid="friction-proposals">
            {proposals.map((proposal) => (
              <li key={proposal.id} className="rounded-lg border border-white/[0.07] bg-black/10 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${PROPOSAL_TONES[proposal.status] || PROPOSAL_TONES.rejected}`}>{proposal.status}</Badge>
                  <span className="font-mono text-[11px] text-zinc-300">{proposal.target}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {proposal.review ? `${proposal.review.decision} by ${proposal.review.reviewed_by}` : "awaiting review"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-300">{proposal.proposed_solution}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{proposal.evidence_note}</p>
                {proposal.status === "proposed" && (
                  reviewing === proposal.id ? (
                    <div className="mt-2 space-y-2">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
                        placeholder="Why approve or reject?"
                        value={reviewNote}
                        onChange={(event) => setReviewNote(event.target.value)}
                        aria-label="Review note"
                        data-testid="friction-review-note"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => review(proposal, "approved")} disabled={busy} data-testid="friction-approve">Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => review(proposal, "rejected")} disabled={busy} data-testid="friction-reject">Reject</Button>
                        <Button size="sm" variant="ghost" onClick={() => setReviewing("")}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" className="border-emerald-500/25 text-emerald-200 hover:bg-emerald-500/[0.08]" onClick={() => { setReviewing(proposal.id); setReviewNote(""); }} data-testid={`friction-review-${proposal.id}`}>
                        <ThumbsUp className="mr-1.5 h-3 w-3" />Review
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setReviewing(proposal.id); setReviewNote(""); }} data-testid={`friction-dismiss-${proposal.id}`}>
                        <ThumbsDown className="mr-1.5 h-3 w-3" />Reject
                      </Button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {boundary && <p className="mt-3 text-[10px] leading-4 text-muted-foreground">{boundary}</p>}
    </section>
  );
}
