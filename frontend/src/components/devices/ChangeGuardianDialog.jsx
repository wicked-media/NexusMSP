import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Loader2,
  Network, RefreshCw, ShieldCheck, Sparkles, Users, XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const RISK_STYLE = {
  low: { ring: "#34d399", text: "text-emerald-700 dark:text-emerald-300", badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" },
  medium: { ring: "#38bdf8", text: "text-sky-700 dark:text-sky-300", badge: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-200" },
  high: { ring: "#f59e0b", text: "text-amber-700 dark:text-amber-300", badge: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200" },
  critical: { ring: "#fb7185", text: "text-rose-700 dark:text-rose-300", badge: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200" },
};

const GATE_ICON = {
  ready: CheckCircle2,
  review: AlertTriangle,
  blocked: XCircle,
};

const GATE_STYLE = {
  ready: "border-emerald-500/18 bg-emerald-500/[0.045] text-emerald-700 dark:text-emerald-200",
  review: "border-amber-500/20 bg-amber-500/[0.055] text-amber-700 dark:text-amber-200",
  blocked: "border-rose-500/20 bg-rose-500/[0.055] text-rose-700 dark:text-rose-200",
};

export default function ChangeGuardianDialog({
  open,
  onOpenChange,
  action,
  deviceIds = [],
  headers,
  busy = false,
  confirmLabel = "Approve and continue",
  onApprove,
  previewOnly = false,
}) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!open || !action || !deviceIds.length) return;
    setLoading(true);
    setError("");
    try {
      const response = await axios.post(`${API}/change-guardian/preview`, {
        entity_type: "device",
        entity_ids: deviceIds,
        action,
      }, { headers });
      setPreview(response.data);
    } catch (requestError) {
      setPreview(null);
      setError(requestError?.response?.data?.detail || "Change impact could not be calculated");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    else {
      setPreview(null);
      setError("");
    }
    // The preview is intentionally recalculated only when the guarded action opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action, deviceIds.join("|")]);

  const risk = preview?.risk || {};
  const tone = RISK_STYLE[risk.level] || RISK_STYLE.medium;
  const visibleDependencies = useMemo(
    () => (preview?.dependencies || []).filter(item => item.count > 0),
    [preview],
  );

  const openRoute = (route) => {
    if (!route) return;
    onOpenChange(false);
    navigate(route);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden border-cyan-500/20 bg-background p-0 shadow-2xl shadow-cyan-950/20" data-testid="change-guardian-dialog">
        <DialogHeader className="shrink-0 border-b border-border/70 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_42%),linear-gradient(135deg,rgba(16,185,129,0.07),transparent)] px-6 py-5 pr-14">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-400/10 shadow-lg shadow-cyan-950/10">
              <ShieldCheck className="h-6 w-6 text-cyan-700 dark:text-cyan-200" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">Nexus Change Guardian</p>
              <DialogTitle className="mt-1 text-xl">{preview?.action_label || "Calculating change impact"}</DialogTitle>
              <DialogDescription className="mt-1 max-w-3xl">
                Review live dependencies, service work and recovery evidence before Nexus queues this action.
              </DialogDescription>
            </div>
            {preview && (
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/75 px-3 py-2">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-full p-[4px]"
                  style={{ background: `conic-gradient(${tone.ring} ${Math.max(0, Math.min(100, risk.score || 0)) * 3.6}deg, rgba(113,113,122,0.18) 0deg)` }}
                  aria-label={`${risk.level} risk ${risk.score}%`}
                >
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-background text-sm font-bold">{risk.score}</div>
                </div>
                <div>
                  <Badge variant="outline" className={tone.badge}>{risk.level} risk</Badge>
                  <p className="mt-1 text-[10px] text-muted-foreground">{risk.approval_required ? "Approval expected" : "Standard boundary"}</p>
                </div>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="nx-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
              <p className="mt-4 text-sm font-medium">Tracing live Nexus relationships…</p>
              <p className="mt-1 text-xs text-muted-foreground">Targets, people, tickets, remote work, backups, alerts and maintenance context.</p>
            </div>
          ) : error ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <XCircle className="h-10 w-10 text-rose-500" />
              <p className="mt-4 font-semibold">Impact preview unavailable</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" className="mt-4" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
            </div>
          ) : preview ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Targets", preview.scope?.resolved, Network],
                  ["Eligible", preview.scope?.eligible, CheckCircle2],
                  ["Clients", preview.scope?.clients, ShieldCheck],
                  ["People", preview.scope?.people, Users],
                  ["Servers", preview.scope?.servers, Sparkles],
                ].map(([label, value, Icon]) => (
                  <div key={label} className="rounded-xl border border-border/70 bg-card/70 p-3">
                    <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    <p className="mt-2 text-xl font-bold">{value || 0}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Expected outcome</p>
                  <p className="mt-2 text-sm leading-relaxed">{preview.expected_outcome}</p>
                </section>
                <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Recovery boundary</p>
                  <p className="mt-2 text-sm leading-relaxed">{preview.rollback}</p>
                </section>
              </div>

              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Change gates</p>
                    <h3 className="mt-1 text-base font-semibold">What must be checked first</h3>
                  </div>
                  <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh evidence</Button>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {(preview.gates || []).map(gate => {
                    const Icon = GATE_ICON[gate.state] || AlertTriangle;
                    return (
                      <div key={gate.id} className={`rounded-xl border p-3 ${GATE_STYLE[gate.state] || GATE_STYLE.review}`}>
                        <div className="flex gap-2.5">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="text-xs font-semibold">{gate.label}</p>
                            <p className="mt-1 text-[11px] leading-relaxed opacity-80">{gate.detail}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Live dependency engine</p>
                    <h3 className="mt-1 text-base font-semibold">Related records in the blast radius</h3>
                  </div>
                  <Badge variant="outline">{visibleDependencies.reduce((sum, item) => sum + item.count, 0)} linked</Badge>
                </div>
                {visibleDependencies.length ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleDependencies.map(item => (
                      <button
                        type="button"
                        key={item.type}
                        disabled={!item.route}
                        onClick={() => openRoute(item.route)}
                        className="rounded-xl border border-border/70 bg-background/55 p-3 text-left transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.045] disabled:cursor-default disabled:hover:border-border/70 disabled:hover:bg-background/55"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold">{item.label}</p>
                          <span className="text-lg font-bold text-cyan-700 dark:text-cyan-300">{item.count}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{item.detail}</p>
                        {item.route && <span className="mt-2 flex items-center gap-1 text-[10px] font-medium text-cyan-700 dark:text-cyan-300">Open records <ExternalLink className="h-3 w-3" /></span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
                    No directly attributable client, user, ticket, session, backup or alert dependency was found. Absence is not treated as proof of no impact.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
                <p className="text-xs font-semibold">Guardian recommendations</p>
                <div className="mt-2 space-y-2">
                  {(preview.recommendations || []).map((item, index) => (
                    <div key={`${item}-${index}`} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </section>

              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {preview.risk?.method} Sources checked: {(preview.evidence?.sources || []).join(", ")}. Preview expires after ten minutes and does not execute the action.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/70 bg-muted/20 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{previewOnly ? "Close check" : "Cancel"}</Button>
          {!previewOnly && <Button
            onClick={() => onApprove?.(preview?.preview_id)}
            disabled={!preview?.execution_allowed || busy || loading}
            className={risk.level === "critical" ? "bg-rose-600 text-white hover:bg-rose-500" : ""}
            data-testid="change-guardian-confirm"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {confirmLabel}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
