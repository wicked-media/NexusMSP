import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ClipboardCheck,
  History,
  Loader2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const reviewTone = {
  attention: "border-rose-500/25 bg-rose-500/[0.045]",
  clear: "border-border/80 bg-background/45",
  reviewed: "border-emerald-500/25 bg-emerald-500/[0.045]",
  exception: "border-amber-500/30 bg-amber-500/[0.055]",
};

function formatReviewedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function formatReviewDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function DailyNocReviewDialog({ open, onOpenChange, token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [snapshot, setSnapshot] = useState(null);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [reviewNotes, setReviewNotes] = useState({});
  const [handoffNote, setHandoffNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const hydrateRun = useCallback((run) => {
    setActiveRun(run || null);
    setReviewNotes(Object.fromEntries((run?.steps || []).map(step => [step.key, step.note || ""])));
    setHandoffNote(run?.handoff_note || "");
  }, []);

  const loadReview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [snapshotResponse, runsResponse] = await Promise.all([
        axios.get(`${API}/dashboard/daily-review`, { headers }),
        axios.get(`${API}/dashboard/daily-review/runs`, { headers }),
      ]);
      const loadedRuns = Array.isArray(runsResponse.data) ? runsResponse.data : [];
      const currentReviewDate = snapshotResponse.data?.run_date;
      setSnapshot(snapshotResponse.data);
      setRuns(loadedRuns);
      hydrateRun(loadedRuns.find(run => run.status === "in_progress" && run.run_date === currentReviewDate) || null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Daily NOC sign-off could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers, hydrateRun, token]);

  useEffect(() => {
    if (open) loadReview();
  }, [loadReview, open]);

  const startReview = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/dashboard/daily-review/runs/start`, {}, { headers });
      hydrateRun(response.data);
      setRuns(current => [response.data, ...current.filter(run => run.id !== response.data.id)]);
      toast.success("Daily NOC sign-off started and attributed to you");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Daily NOC sign-off could not be started");
    } finally {
      setSaving(false);
    }
  };

  const recordStep = async (step, outcome) => {
    if (!activeRun) return;
    const note = String(reviewNotes[step.key] || "").trim();
    if (outcome === "exception" && note.length < 8) {
      toast.error("Record the exception, owner, or next action first");
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/dashboard/daily-review/runs/${activeRun.id}/steps/${step.key}`,
        { outcome, note },
        { headers },
      );
      hydrateRun(response.data);
      setRuns(current => current.map(run => run.id === response.data.id ? response.data : run));
      toast.success(`${step.title} marked ${outcome}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Review evidence could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  const completeReview = async () => {
    if (!activeRun) return;
    if (handoffNote.trim().length < 12) {
      toast.error("Record a meaningful handoff or all-clear summary");
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/dashboard/daily-review/runs/${activeRun.id}/complete`,
        { handoff_note: handoffNote.trim() },
        { headers },
      );
      setRuns(current => current.map(run => run.id === response.data.id ? response.data : run));
      hydrateRun(null);
      toast.success("Daily NOC review signed off with retained evidence");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Daily NOC sign-off could not be completed");
    } finally {
      setSaving(false);
    }
  };

  const cancelReview = async () => {
    if (!activeRun || cancelReason.trim().length < 8) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/dashboard/daily-review/runs/${activeRun.id}/cancel`,
        { reason: cancelReason.trim() },
        { headers },
      );
      setRuns(current => current.map(run => run.id === response.data.id ? response.data : run));
      hydrateRun(null);
      setCancelOpen(false);
      setCancelReason("");
      toast.success("Daily NOC review cancelled with its reason retained");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Daily NOC sign-off could not be cancelled");
    } finally {
      setSaving(false);
    }
  };

  const reviewedCount = (activeRun?.steps || []).filter(step => step.outcome !== "pending").length;
  const totalSteps = activeRun?.steps?.length || 0;
  const pendingSteps = totalSteps - reviewedCount;
  const latestCompleted = runs.find(run => run.status === "completed");
  const previousUnfinished = runs.find(run =>
    run.status === "in_progress" && run.run_date !== snapshot?.run_date
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[92vh] overflow-hidden border-primary/20 p-0 sm:max-w-5xl"
          aria-describedby="daily-review-description"
          data-testid="daily-noc-review-dialog"
        >
          <DialogHeader className="border-b border-border/80 bg-gradient-to-r from-primary/[0.10] via-card to-card px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <ClipboardCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-primary">Nexus Daily</p>
                <DialogTitle className="mt-1 text-xl">Daily NOC sign-off</DialogTitle>
                <DialogDescription id="daily-review-description" className="mt-1 max-w-3xl">
                  Validate the live Dashboard evidence, assign every exception, and leave an attributable shift handoff.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(92vh-104px)] overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />Loading current operational evidence…
              </div>
            ) : activeRun ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/80 bg-muted/25 p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Review date</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{formatReviewDate(activeRun.run_date)}</p>
                    <p className={`mt-0.5 text-[10px] ${activeRun.run_date === snapshot?.run_date ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
                      {activeRun.run_date === snapshot?.run_date ? "Current operational day" : "Retained prior review"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-muted/25 p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Snapshot health</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{activeRun.snapshot_health_score}% at launch</p>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-muted/25 p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Evidence progress</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{reviewedCount}/{totalSteps} sections reviewed</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {(activeRun.steps || []).map((step, index) => {
                    const reviewed = step.outcome !== "pending";
                    const exception = step.outcome === "exception";
                    const tone = exception
                      ? reviewTone.exception
                      : reviewed
                        ? reviewTone.reviewed
                        : reviewTone[step.signal] || reviewTone.clear;
                    return (
                      <section key={step.key} className={`rounded-xl border p-4 ${tone}`}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex min-w-0 gap-3">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${reviewed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-border bg-background/60 text-muted-foreground"}`}>
                              {reviewed ? <Check className="h-4 w-4" /> : index + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-foreground">{step.title}</h3>
                                <Badge variant="outline" className={step.signal === "attention" ? "border-rose-500/30 text-rose-600 dark:text-rose-300" : "border-emerald-500/25 text-emerald-700 dark:text-emerald-300"}>
                                  {step.signal === "attention" ? "Needs review" : "Clear signal"}
                                </Badge>
                                {reviewed && (
                                  <Badge variant="outline" className={exception ? "border-amber-500/30 text-amber-700 dark:text-amber-300" : "border-cyan-500/25 text-cyan-700 dark:text-cyan-300"}>
                                    {step.outcome}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                              <p className="mt-2 text-xs font-medium text-foreground">{step.evidence}</p>
                              <p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Evidence: {step.source}</p>
                            </div>
                          </div>
                          {step.reviewed_by && (
                            <p className="shrink-0 text-[10px] text-muted-foreground">
                              {step.reviewed_by} · {formatReviewedAt(step.reviewed_at)}
                            </p>
                          )}
                        </div>
                        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
                          <textarea
                            value={reviewNotes[step.key] ?? step.note ?? ""}
                            onChange={event => setReviewNotes(current => ({ ...current, [step.key]: event.target.value }))}
                            placeholder={step.signal === "attention" ? "Record owner, linked ticket, validation, or next action…" : "Optional review note…"}
                            className="min-h-[72px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
                          />
                          <div className="flex flex-wrap gap-2 lg:w-40 lg:flex-col">
                            <Button size="sm" variant="outline" onClick={() => recordStep(step, "reviewed")} disabled={saving}>
                              <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-500" />Reviewed
                            </Button>
                            <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-700 hover:bg-amber-500/[0.08] dark:text-amber-300" onClick={() => recordStep(step, "exception")} disabled={saving}>
                              <AlertTriangle className="mr-1.5 h-4 w-4" />Exception
                            </Button>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>

                <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.045] p-4">
                  <Label htmlFor="daily-noc-handoff" className="text-foreground">Shift handoff and sign-off summary</Label>
                  <p className="mt-1 text-xs text-muted-foreground">State the all-clear, outstanding owners, linked tickets, or what the next technician must do.</p>
                  <textarea
                    id="daily-noc-handoff"
                    value={handoffNote}
                    onChange={event => setHandoffNote(event.target.value)}
                    placeholder="Example: SLA exception assigned to Sarah; backup queue clear; follow up TKT-1042 before 10:00…"
                    className="mt-3 min-h-[96px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
                  />
                </section>

                <div className="flex flex-col-reverse gap-3 border-t border-border/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <Button variant="ghost" className="text-rose-600 hover:bg-rose-500/[0.08] hover:text-rose-700 dark:text-rose-300" onClick={() => setCancelOpen(true)}>
                    <Ban className="mr-1.5 h-4 w-4" />Cancel review
                  </Button>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Save and continue later</Button>
                    <Button onClick={completeReview} disabled={saving || pendingSteps > 0 || handoffNote.trim().length < 12}>
                      {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
                      Sign off review
                    </Button>
                  </div>
                </div>
                {pendingSteps > 0 && (
                  <p className="text-right text-xs text-amber-700 dark:text-amber-300">
                    {pendingSteps} section{pendingSteps === 1 ? "" : "s"} still require review before sign-off.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {previousUnfinished && (
                  <section className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <History className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">A previous review remains unfinished</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatReviewDate(previousUnfinished.run_date)} is retained for audit, but it will never be presented as today&apos;s sign-off.
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" className="shrink-0 border-amber-500/30" onClick={() => hydrateRun(previousUnfinished)}>
                      Open retained review
                    </Button>
                  </section>
                )}

                <section className="rounded-2xl border border-border/80 bg-gradient-to-br from-primary/[0.07] via-background to-background p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                        <ShieldCheck className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className="font-semibold text-foreground">One audited review, inside Dashboard</h3>
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                          Nexus captures a point-in-time view of assets, tickets, backups, security, patching, voice and billing. Every decision is attributed and retained.
                        </p>
                      </div>
                    </div>
                    <Button onClick={startReview} disabled={saving} data-testid="start-daily-noc-review">
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                      Start audited review
                    </Button>
                  </div>
                </section>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-border/80 bg-card p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Live health</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{snapshot?.health_score ?? "—"}%</p>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-card p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Assets offline</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{snapshot?.devices?.offline ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-card p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Critical tickets</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{snapshot?.tickets?.critical_high ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-card p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Backup failures</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{snapshot?.backups?.failed ?? "—"}</p>
                  </div>
                </div>

                <section className="rounded-xl border border-border/80 bg-muted/20 p-4">
                  <div className="flex items-start gap-3">
                    <History className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Latest completed sign-off</p>
                      {latestCompleted ? (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {formatReviewDate(latestCompleted.run_date)} · completed by {latestCompleted.completed_by || "Unknown technician"}
                          {latestCompleted.handoff_note ? ` · ${latestCompleted.handoff_note}` : ""}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">No completed daily sign-off is recorded yet.</p>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Ban className="h-5 w-5 text-rose-500" />Cancel daily NOC review</DialogTitle>
            <DialogDescription>The snapshot and completed sections remain in history. Cancellation never represents the review as complete.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-daily-review-reason">Cancellation reason</Label>
            <textarea
              id="cancel-daily-review-reason"
              value={cancelReason}
              onChange={event => setCancelReason(event.target.value)}
              placeholder="Explain why this review is being stopped…"
              className="min-h-[96px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep review</Button>
            <Button variant="destructive" onClick={cancelReview} disabled={saving || cancelReason.trim().length < 8}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Cancel and retain record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
