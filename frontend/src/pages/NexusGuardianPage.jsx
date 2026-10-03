import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, EyeOff } from "lucide-react";
import { toast } from "sonner";

const SEVERITY_TONE = {
  critical: "border-red-400/30 text-red-200",
  high: "border-orange-400/30 text-orange-200",
  medium: "border-amber-400/30 text-amber-200",
  low: "border-slate-400/30 text-slate-200",
};

/**
 * Nexus Guardian — the Nexus-branded adaptive SOC workspace. Defender posture
 * and an explainable triage queue that re-ranks as technicians triage: every
 * score shows why it earned its rank, and dispositions teach the queue.
 */
export default function NexusGuardianPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [queue, setQueue] = useState([]);
  const [adaptive, setAdaptive] = useState({ signal_weights: {}, suggestions: [] });
  const [posture, setPosture] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queueResponse, postureResponse] = await Promise.all([
        axios.get(`${API}/nexus-guardian/triage-queue`, { headers }),
        axios.get(`${API}/nexus-guardian/posture`, { headers }),
      ]);
      setQueue(queueResponse.data?.queue || []);
      setAdaptive(queueResponse.data?.adaptive || { signal_weights: {}, suggestions: [] });
      setPosture(postureResponse.data?.defender || null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Guardian could not load");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const sendFeedback = async (alert, disposition) => {
    setFeedbackBusy(alert.id || "");
    try {
      const response = await axios.post(`${API}/nexus-guardian/feedback`, {
        signal: alert.signal || alert.title || alert.id || "unknown",
        disposition,
        client_id: alert.client_id || null,
      }, { headers });
      setAdaptive({
        signal_weights: response.data?.signal_weights || {},
        suggestions: response.data?.suggestions || [],
      });
      toast.success("Recorded — Guardian re-ranked the queue from your call.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Feedback could not be recorded");
    } finally {
      setFeedbackBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">Nexus Security</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Nexus Guardian</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Managed detection and response built on Windows Defender and Nexus Agent evidence. The triage
            queue adapts to how your team triages — every rank explains itself.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} data-testid="guardian-refresh">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="rounded-2xl border-border/60 bg-background/65">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Defender coverage</p>
            <p className="mt-2 text-2xl font-semibold text-foreground" data-testid="guardian-coverage">
              {posture?.coverage_pct == null ? "Not assessed" : `${posture.coverage_pct}%`}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {posture ? `${posture.protected} protected · ${posture.not_assessed} not assessed` : "Awaiting evidence"}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/60 bg-background/65">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Signatures stale</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{posture?.signature_stale?.length ?? "—"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Older than 3 days</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/60 bg-background/65">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Realtime off</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{posture?.realtime_disabled?.length ?? "—"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Endpoints needing attention</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-cyan-400/20 bg-cyan-400/[0.04]">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Queue depth</p>
            <p className="mt-2 text-2xl font-semibold text-foreground" data-testid="guardian-queue-depth">{queue.length}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Ranked by adaptive priority</p>
          </CardContent>
        </Card>
      </div>

      {adaptive.suggestions?.length > 0 && (
        <Card className="rounded-2xl border-cyan-400/20 bg-cyan-400/[0.04]" data-testid="guardian-suggestions">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />Guardian suggests
            </p>
            <ul className="mt-2 space-y-1">
              {adaptive.suggestions.map((s) => (
                <li key={s.id} className="rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground">{s.text}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-border/60 bg-background/65">
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Adaptive triage queue</p>
          {loading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading queue…</p>
          ) : queue.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="guardian-empty">
              No open detections. Guardian keeps watching — posture evidence appears the moment agents report.
            </p>
          ) : (
            <div className="mt-3 space-y-2" data-testid="guardian-queue">
              {queue.map((alert) => (
                <div key={alert.id} className="rounded-xl border border-border/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={SEVERITY_TONE[alert.severity] || "border-slate-400/30 text-slate-200"}>
                        {alert.severity || "medium"}
                      </Badge>
                      <p className="text-sm font-medium text-foreground">{alert.title || alert.signal || alert.id}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="border-cyan-400/25 text-cyan-100" title={(alert.triage?.reasons || []).join("; ")}>
                        score {alert.triage?.score}
                      </Badge>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={feedbackBusy === alert.id}
                        onClick={() => sendFeedback(alert, "true_positive")} data-testid={`guardian-tp-${alert.id}`}>
                        <ThumbsUp className="mr-1 h-3 w-3" />True positive
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={feedbackBusy === alert.id}
                        onClick={() => sendFeedback(alert, "false_positive")} data-testid={`guardian-fp-${alert.id}`}>
                        <ThumbsDown className="mr-1 h-3 w-3" />False positive
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={feedbackBusy === alert.id}
                        onClick={() => sendFeedback(alert, "accepted_risk")} data-testid={`guardian-ar-${alert.id}`}>
                        <EyeOff className="mr-1 h-3 w-3" />Accepted risk
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                    <ShieldCheck className="mr-1 inline h-3 w-3" />
                    {(alert.triage?.reasons || []).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
