import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Lightbulb, Send, Sparkles } from "lucide-react";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  clusterEvidenceLines,
  clusterPath,
  dispositionFormErrors,
  dispositionOptions,
  dispositionPayload,
  promotionFormErrors,
  promotionPayload,
  promotionReason,
  recordedDisposition,
  suggestionText,
  wishFormErrors,
  wishPayload,
} from "@/lib/wishEngine";

const DEFAULT_SURFACE = "control-plane";

/**
 * Technician Wish Engine — the unmet need, stated by the person doing the work.
 *
 * The card reads the shared request patterns Nexus derived and lets a reviewer
 * record what each one should become. Two boundaries are stated on screen rather
 * than hidden: a request is quoted to reviewers only once someone else reports
 * the same shape, and nothing reaches the Nexus Ideas registry without a recorded
 * disposition and its reasoning.
 */
export default function WishEngineCard({ headers, onChanged }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ text: "", surface: DEFAULT_SURFACE, context_ref: "" });
  const [formErrors, setFormErrors] = useState([]);
  const [openCluster, setOpenCluster] = useState("");
  const [disposition, setDisposition] = useState({ disposition: "shortcut", evidence_note: "" });
  const [promotion, setPromotion] = useState({ title: "", summary: "", horizon: "explore" });
  const [actionErrors, setActionErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/wish-engine/wishes`, { headers });
      setOverview(data);
    } catch {
      toast.error("Nexus could not read the Wish Engine evidence.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const report = async () => {
    const errors = wishFormErrors(form);
    setFormErrors(errors);
    if (errors.length) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/wish-engine/wishes`, wishPayload(form), { headers });
      setForm({ text: "", surface: form.surface, context_ref: "" });
      await load();
      onChanged?.();
      if (data.clustered) {
        toast.success("Reported — this is now a shared pattern", {
          description: `${data.cluster.occurrences} technicians have reported the same shape, so it is waiting for review.`,
        });
      } else {
        toast.success("Reported", {
          description: "It stays with you and appears to reviewers only as a count until someone else reports the same shape.",
        });
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The request could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (cluster) => {
    const errors = dispositionFormErrors(disposition);
    setActionErrors(errors);
    if (errors.length) return;
    setBusy(true);
    try {
      await axios.post(
        `${API}/wish-engine/clusters/${clusterPath(cluster)}/disposition`,
        dispositionPayload(disposition),
        { headers },
      );
      setOpenCluster("");
      setDisposition({ disposition: "shortcut", evidence_note: "" });
      setActionErrors([]);
      await load();
      onChanged?.();
      toast.success("Disposition recorded", { description: "A promotion now needs the idea's title and why it matters." });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The disposition could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const promote = async (cluster) => {
    const errors = promotionFormErrors(promotion);
    setActionErrors(errors);
    if (errors.length) return;
    setBusy(true);
    try {
      const { data } = await axios.post(
        `${API}/wish-engine/clusters/${clusterPath(cluster)}/promote`,
        promotionPayload(promotion),
        { headers },
      );
      setOpenCluster("");
      setPromotion({ title: "", summary: "", horizon: "explore" });
      setActionErrors([]);
      await load();
      onChanged?.();
      toast.success(`Captured in the Nexus Ideas registry as ${data.idea.title}`, { description: data.policy });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The request could not be promoted.");
    } finally {
      setBusy(false);
    }
  };

  const clusters = overview?.clusters || [];
  const options = dispositionOptions(overview?.dispositions);
  const mine = overview?.mine || [];

  return (
    <section
      className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.05] via-card to-cyan-500/[0.025] p-4"
      data-testid="wish-engine-card"
    >
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/[0.09]">
          <Lightbulb className="h-4 w-4 text-amber-200" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">Technician Wish Engine</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            The unmet need, stated by the person doing the work. Nexus groups identical shapes of frustration and asks a
            person what each one should become — it never decides alone.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto border-amber-500/25 text-[10px] text-amber-100" data-testid="wish-cluster-count">
          {clusters.length} shared pattern{clusters.length === 1 ? "" : "s"}
        </Badge>
      </header>

      <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3" data-testid="wish-form">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">This should be easier</p>
        <Textarea
          className="mt-2"
          rows={2}
          value={form.text}
          onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))}
          placeholder="I shouldn't have to open five screens to find the device's warranty."
          aria-label="What should be easier"
          data-testid="wish-text"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={form.surface}
            onChange={(event) => setForm((current) => ({ ...current, surface: event.target.value }))}
            placeholder="Workspace: devices, tickets, invoices…"
            aria-label="Workspace the request was felt in"
            data-testid="wish-surface"
          />
          <Input
            value={form.context_ref}
            onChange={(event) => setForm((current) => ({ ...current, context_ref: event.target.value }))}
            placeholder="Optional reference (record ID, not content)"
            aria-label="Context reference"
            data-testid="wish-context-ref"
          />
          <Button onClick={report} disabled={busy} className="gap-1.5" data-testid="wish-submit">
            <Send className="h-3.5 w-3.5" />Report
          </Button>
        </div>
        {formErrors.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="wish-form-errors">
            {formErrors.map((error) => (
              <li key={error} className="text-[10px] text-rose-300">{error}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {overview?.total_requests ?? 0} request(s) recorded · {overview?.clustered_requests ?? 0} in a shared pattern ·{" "}
          {overview?.unclustered_requests ?? 0} still with their author. A pattern starts at{" "}
          {overview?.cluster_min_occurrences ?? 2} identical reports.
        </p>
      </div>

      {mine.length > 0 && (
        <div className="mt-3" data-testid="wish-mine">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your requests</p>
          <ul className="space-y-1.5">
            {mine.map((row) => (
              <li key={row.id} className="rounded-lg border border-white/[0.07] bg-black/10 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-400">{row.surface}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{suggestionText(row.suggestion)}</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-300">{row.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && !overview && <p className="mt-3 text-[11px] text-muted-foreground">Reading the request record…</p>}

      {overview && clusters.length === 0 && (
        <p className="mt-3 rounded-lg border border-white/[0.07] bg-black/10 p-3 text-[11px] text-muted-foreground" data-testid="wish-empty">
          No shared pattern yet. A statement of frustration is quoted here only once at least{" "}
          {overview.cluster_min_occurrences} technicians report the same shape, so the queue stays a shared-need list
          rather than a window onto one person's opinions.
        </p>
      )}

      <ul className="mt-3 space-y-2" data-testid="wish-clusters">
        {clusters.map((cluster) => {
          const recorded = recordedDisposition(cluster);
          const canPromote = Boolean(cluster.promotion?.allowed);
          return (
            <li
              key={cluster.signature}
              className="rounded-xl border border-white/[0.07] bg-black/10 p-3"
              data-testid={`wish-cluster-${cluster.signature}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-cyan-500/25 text-[10px] text-cyan-100">
                  {cluster.occurrences} report{cluster.occurrences === 1 ? "" : "s"}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{cluster.reporter_count} technician(s)</span>
                <span className="ml-auto text-[10px] text-muted-foreground" data-testid="wish-suggestion">
                  {suggestionText(cluster.suggested_disposition)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-300">“{cluster.representative_text}”</p>
              <div className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {clusterEvidenceLines(cluster).map((line) => (
                  <p key={line.label} className="text-[10px] text-muted-foreground">
                    <span className="text-zinc-400">{line.label}: </span>{line.text}
                  </p>
                ))}
              </div>

              {recorded ? (
                <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/20 p-2.5" data-testid="wish-recorded">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${recorded.tone}`}>{recorded.label}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      decided by {recorded.decidedBy} over {recorded.occurrencesAtDecision ?? cluster.occurrences} report(s)
                    </span>
                    {recorded.ideaId && (
                      <span className="ml-auto text-[10px] text-emerald-200">
                        promoted to the idea registry as {recorded.ideaTitle}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{recorded.evidenceNote}</p>
                </div>
              ) : (
                <p className="mt-2 text-[10px] text-muted-foreground" data-testid="wish-undecided">
                  No disposition recorded. Nexus will not promote a shape nobody has decided on.
                </p>
              )}

              {openCluster === cluster.signature ? (
                <div className="mt-2 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
                    <select
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-amber-400/40"
                      value={disposition.disposition}
                      onChange={(event) => setDisposition((current) => ({ ...current, disposition: event.target.value }))}
                      aria-label="What this request should become"
                      data-testid="wish-disposition-select"
                    >
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <Input
                      value={disposition.evidence_note}
                      onChange={(event) => setDisposition((current) => ({ ...current, evidence_note: event.target.value }))}
                      placeholder="What evidence supports this decision?"
                      aria-label="Disposition evidence"
                      data-testid="wish-disposition-note"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {options.find((option) => option.value === disposition.disposition)?.meaning}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decide(cluster)} disabled={busy} data-testid="wish-disposition-submit">
                      Record disposition
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setOpenCluster(""); setActionErrors([]); }}>Cancel</Button>
                  </div>

                  {canPromote && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">Promote into Nexus Ideas</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
                        <Input
                          value={promotion.title}
                          onChange={(event) => setPromotion((current) => ({ ...current, title: event.target.value }))}
                          placeholder="Idea title"
                          aria-label="Idea title"
                          data-testid="wish-promote-title"
                        />
                        <Input
                          value={promotion.horizon}
                          onChange={(event) => setPromotion((current) => ({ ...current, horizon: event.target.value }))}
                          placeholder="explore"
                          aria-label="Horizon"
                          data-testid="wish-promote-horizon"
                        />
                      </div>
                      <Textarea
                        className="mt-2"
                        rows={2}
                        value={promotion.summary}
                        onChange={(event) => setPromotion((current) => ({ ...current, summary: event.target.value }))}
                        placeholder="Why this shared pattern matters, and what it changes for a technician."
                        aria-label="Why it matters"
                        data-testid="wish-promote-summary"
                      />
                      <Button size="sm" className="mt-2 gap-1.5" onClick={() => promote(cluster)} disabled={busy} data-testid="wish-promote-submit">
                        <Sparkles className="h-3.5 w-3.5" />Capture as a candidate idea
                      </Button>
                      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                        Capturing a candidate does not approve, schedule or release the work; dependencies, evidence, an
                        owner and a release gate are still required.
                      </p>
                    </div>
                  )}

                  {!canPromote && (
                    <p className="text-[10px] leading-4 text-amber-200" data-testid="wish-promotion-gate">
                      {promotionReason(cluster)}
                    </p>
                  )}

                  {actionErrors.length > 0 && (
                    <ul className="space-y-1" data-testid="wish-action-errors">
                      {actionErrors.map((error) => (
                        <li key={error} className="text-[10px] text-rose-300">{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 border-amber-500/25 text-amber-100 hover:bg-amber-500/[0.08]"
                  onClick={() => {
                    setOpenCluster(cluster.signature);
                    setDisposition({
                      disposition: cluster.disposition?.disposition || cluster.suggested_disposition?.disposition || "shortcut",
                      evidence_note: cluster.disposition?.evidence_note || "",
                    });
                    setPromotion({ title: cluster.representative_text.slice(0, 120), summary: "", horizon: "explore" });
                    setActionErrors([]);
                  }}
                  data-testid={`wish-review-${cluster.signature}`}
                >
                  Review this pattern
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {overview?.boundary && (
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground" data-testid="wish-boundary">{overview.boundary}</p>
      )}
    </section>
  );
}
