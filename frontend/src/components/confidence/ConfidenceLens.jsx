import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleHelp,
  Eye,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Progress } from "../ui/progress";
import { Textarea } from "../ui/textarea";


const TONES = {
  verified: {
    ring: "#10b981",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    panel: "border-emerald-500/20 bg-emerald-500/[0.045]",
  },
  strong: {
    ring: "#22d3ee",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    panel: "border-cyan-500/20 bg-cyan-500/[0.045]",
  },
  review: {
    ring: "#f59e0b",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    panel: "border-amber-500/20 bg-amber-500/[0.045]",
  },
  low: {
    ring: "#f43f5e",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    panel: "border-rose-500/20 bg-rose-500/[0.045]",
  },
  unavailable: {
    ring: "#71717a",
    badge: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
    panel: "border-zinc-500/20 bg-zinc-500/[0.045]",
  },
};

const severityClass = (severity) => ({
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
}[severity] || "border-zinc-500/30 text-muted-foreground");

const relativeTime = (value) => {
  if (!value) return "No dated evidence";
  try { return formatDistanceToNow(new Date(value), { addSuffix: true }); } catch { return "Date unavailable"; }
};


function ScoreOrb({ profile, size = 68 }) {
  const tone = TONES[profile?.state] || TONES.unavailable;
  const score = profile?.score || 0;
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${tone.ring} ${score * 3.6}deg, color-mix(in srgb, ${tone.ring} 13%, transparent) 0deg)`,
        boxShadow: `0 0 24px color-mix(in srgb, ${tone.ring} 18%, transparent)`,
      }}
      aria-label={`${profile?.label || "Unavailable"} confidence ${score}%`}
    >
      <span className="absolute inset-[5px] rounded-full border border-border/70 bg-background/95" />
      <span className="relative text-center">
        <span className="block text-lg font-bold leading-none">{score}%</span>
        <span className="mt-1 block font-mono text-[7px] uppercase tracking-[0.12em] text-muted-foreground">trust</span>
      </span>
    </div>
  );
}


function DimensionRow({ dimension }) {
  const score = Number(dimension.score || 0);
  const tone = score >= 90 ? "text-emerald-600 dark:text-emerald-300" : score >= 75 ? "text-cyan-600 dark:text-cyan-300" : score >= 50 ? "text-amber-600 dark:text-amber-300" : "text-rose-600 dark:text-rose-300";
  return (
    <div className="rounded-xl border border-border/70 bg-muted/15 p-3" data-testid={`confidence-dimension-${dimension.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{dimension.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{dimension.detail}</p>
        </div>
        <span className={`text-lg font-bold ${tone}`}>{score}%</span>
      </div>
      <Progress value={score} className="mt-3 h-1.5" />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span>{dimension.evidence_count} evidence record{dimension.evidence_count === 1 ? "" : "s"}</span>
        <span>·</span>
        <span>{dimension.freshness == null ? "Undated" : `${dimension.freshness}% fresh`}</span>
        <span>·</span>
        <span>{dimension.sources.join(", ") || "No source"}</span>
      </div>
    </div>
  );
}


export default function ConfidenceLens({
  entityType,
  entityId,
  token,
  API,
  variant = "card",
  className = "",
}) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [validForDays, setValidForDays] = useState("90");
  const [saving, setSaving] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(async () => {
    if (!entityType || !entityId) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/confidence/${entityType}/${entityId}`, { headers });
      setProfile(response.data);
    } catch (error) {
      setProfile(null);
      if (error?.response?.status !== 404) {
        toast.error(error?.response?.data?.detail || "Confidence evidence could not be loaded");
      }
    } finally {
      setLoading(false);
    }
  }, [API, entityId, entityType, headers]);

  useEffect(() => { load(); }, [load]);

  const verify = async () => {
    if (reviewNote.trim().length < 10) {
      toast.error("Record what you checked in at least 10 characters");
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/confidence/${entityType}/${entityId}/verify`,
        { note: reviewNote.trim(), valid_for_days: Number(validForDays) },
        { headers },
      );
      setProfile(response.data.profile);
      setReviewMode(false);
      setReviewNote("");
      toast.success("Confidence review recorded; source gaps remain visible");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The confidence review could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  if (loading && variant === "compact") {
    return <div className={`flex h-12 min-w-40 items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 text-xs text-muted-foreground ${className}`}><Loader2 className="h-4 w-4 animate-spin" />Assessing confidence</div>;
  }
  if (loading) {
    return <Card className={className}><CardContent className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Assessing attributable evidence</CardContent></Card>;
  }
  if (!profile) return null;

  const tone = TONES[profile.state] || TONES.unavailable;
  const topGaps = profile.next_actions || [];
  const attestation = profile.attestation || {};

  const trigger = variant === "compact" ? (
    <button
      type="button"
      onClick={() => setDialogOpen(true)}
      className={`group flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${tone.panel} ${className}`}
      data-testid={`confidence-lens-${entityType}-${entityId}`}
      title="Open the evidence-based confidence profile"
    >
      <ScoreOrb profile={profile} size={44} />
      <span className="min-w-0">
        <span className="block font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Confidence</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold">{profile.label}<ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span>
        <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{topGaps.length ? `${topGaps.length} evidence gap${topGaps.length === 1 ? "" : "s"}` : "Evidence ready"}</span>
      </span>
    </button>
  ) : (
    <Card className={`overflow-hidden ${tone.panel} ${className}`} data-testid={`confidence-lens-${entityType}-${entityId}`}>
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <ScoreOrb profile={profile} />
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Nexus Confidence</p>
              <CardTitle className="mt-1 text-lg">How much can I trust this record?</CardTitle>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">A live measure of completeness, freshness, attribution and conflicting evidence. This is not the operational health score.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={tone.badge}>{profile.label}</Badge>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}><Eye className="mr-1.5 h-4 w-4" />Inspect evidence</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 lg:grid-cols-[1fr_0.8fr]">
        <div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {profile.dimensions.slice(0, 6).map((dimension) => (
              <div key={dimension.key} className="rounded-lg border border-border/70 bg-background/35 p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{dimension.label}</span><span className="text-sm font-bold">{dimension.score}%</span></div>
                <Progress value={dimension.score} className="mt-2 h-1.5" />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">Last attributable evidence {relativeTime(profile.last_observed_at)} · {profile.evidence_count} retained record{profile.evidence_count === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/35 p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">What needs verification?</p><Badge variant="outline" className="text-[9px]">{profile.gaps.length} gaps</Badge></div>
          <div className="mt-3 space-y-2">
            {topGaps.length ? topGaps.slice(0, 3).map((gap) => (
              <button key={`${gap.dimension_key}-${gap.key}`} type="button" onClick={() => gap.route && navigate(gap.route)} disabled={!gap.route} className="flex w-full items-start gap-2 rounded-lg border border-border/60 p-2 text-left enabled:hover:bg-muted/30">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed">{gap.label}</span>
                {gap.route && <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
            )) : <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />No source-evidence gaps are open.</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <>
      {trigger}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setReviewMode(false); }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto" aria-describedby="confidence-lens-description">
          <DialogHeader className="border-b border-border/70 pb-4">
            <div className="flex items-start gap-3 pr-8">
              <ScoreOrb profile={profile} />
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Nexus Confidence · {profile.entity.type}</p>
                <DialogTitle className="mt-1">{profile.entity.label}</DialogTitle>
                <DialogDescription id="confidence-lens-description" className="mt-1">Know whether the record is safe to act on before making a change.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">State</p><p className="mt-1 text-lg font-semibold">{profile.label}</p></div>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Evidence</p><p className="mt-1 text-lg font-semibold">{profile.evidence_count}</p></div>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open gaps</p><p className="mt-1 text-lg font-semibold">{profile.gaps.length}</p></div>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Conflicts</p><p className="mt-1 text-lg font-semibold">{profile.conflicts.length}</p></div>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div><p className="text-sm font-semibold">Evidence dimensions</p><p className="mt-1 text-xs text-muted-foreground">Every score remains explainable down to source, check and observation time.</p></div>
              <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh sources</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">{profile.dimensions.map((dimension) => <DimensionRow key={dimension.key} dimension={dimension} />)}</div>
          </section>

          {(profile.conflicts.length > 0 || profile.gaps.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-semibold">Evidence gaps</p><Badge variant="outline">{profile.gaps.length}</Badge></div>
                <div className="space-y-2">
                  {profile.gaps.slice(0, 8).map((gap) => (
                    <button key={`${gap.dimension_key}-${gap.key}`} type="button" onClick={() => { if (gap.route) { setDialogOpen(false); navigate(gap.route); } }} disabled={!gap.route} className="flex w-full items-start gap-2 rounded-lg border border-border/70 bg-muted/15 p-3 text-left enabled:hover:bg-muted/30">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                      <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{gap.label}</span><span className="mt-1 block text-[10px] text-muted-foreground">{gap.dimension}</span></span>
                      <Badge variant="outline" className={`h-5 text-[9px] uppercase ${severityClass(gap.severity)}`}>{gap.severity}</Badge>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-semibold">Conflicting records</p><Badge variant="outline">{profile.conflicts.length}</Badge></div>
                {profile.conflicts.length ? <div className="space-y-2">{profile.conflicts.map((conflict) => <button key={conflict.key} type="button" onClick={() => { if (conflict.route) { setDialogOpen(false); navigate(conflict.route); } }} className="flex w-full items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3 text-left hover:bg-rose-500/[0.09]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" /><span className="min-w-0 flex-1 text-xs">{conflict.label}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></button>)}</div> : <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-xs text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" />No conflicting source records were detected.</div>}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.045] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-300" />
                <div>
                  <p className="text-sm font-semibold">{attestation.current ? "Current human review" : "Human review not current"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {attestation.current
                      ? `${attestation.verified_by || "A technician"} reviewed this ${relativeTime(attestation.verified_at)}. ${attestation.note || ""}`
                      : "A technician can record what was checked. This attestation never raises the score or conceals missing evidence."}
                  </p>
                </div>
              </div>
              {!reviewMode && <Button size="sm" onClick={() => setReviewMode(true)}><BadgeCheck className="mr-1.5 h-4 w-4" />Record review</Button>}
            </div>
            {reviewMode && (
              <div className="mt-4 grid gap-3 border-t border-cyan-500/15 pt-4 md:grid-cols-[1fr_180px]">
                <div><Label>What did you verify?</Label><Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Checked the source records against the current client, endpoint or document…" className="mt-1.5 min-h-24" /></div>
                <div><Label>Review validity</Label><select value={validForDays} onChange={(event) => setValidForDays(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option></select><p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Source data can still lower confidence before this review expires.</p></div>
                <div className="flex flex-wrap gap-2 md:col-span-2"><Button onClick={verify} disabled={saving || reviewNote.trim().length < 10}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-1.5 h-4 w-4" />}Save evidence review</Button><Button variant="ghost" onClick={() => setReviewMode(false)} disabled={saving}>Cancel</Button></div>
              </div>
            )}
          </section>

          <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{profile.method}</div>
          <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setDialogOpen(false); navigate("/help/nexus-confidence"); }}><CircleHelp className="mr-1.5 h-4 w-4" />How Confidence works</Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
