import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowRight, Building2, CalendarClock, CheckCircle2, Clock3, Loader2, RefreshCw, UserRound } from "lucide-react";

import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PRIORITY_WEIGHT = { high: 3, normal: 2, low: 1 };

const isOpen = (item) => item?.status === "open";

const isOverdue = (item, now = Date.now()) => {
  if (!isOpen(item) || !item?.due_at) return false;
  const dueAt = new Date(item.due_at).getTime();
  return Number.isFinite(dueAt) && dueAt < now;
};

const dueLabel = (value) => {
  if (!value) return "No due date recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Due date unavailable";
  return formatDistanceToNow(date, { addSuffix: true });
};

const readableKind = (kind) => String(kind || "task").replaceAll("_", " ");

/**
 * Portfolio-level read model for account commitments assigned to the current
 * technician. Editing deliberately stays in the relevant client record, so a
 * customer promise always retains its relationship context and audit trail.
 */
export default function ClientPortfolioFollowUpsPanel({ token, onOpenClient, maxItems = 4 }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [followUps, setFollowUps] = useState([]);
  const [possiblyTruncated, setPossiblyTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await axios.get(`${API}/client-follow-ups/mine`, {
        headers,
        timeout: 15000,
      });
      if (version !== requestVersion.current) return;
      setFollowUps(Array.isArray(response.data?.follow_ups) ? response.data.follow_ups : []);
      setPossiblyTruncated(Boolean(response.data?.possibly_truncated));
    } catch {
      if (version !== requestVersion.current) return;
      setLoadError(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  const openItems = useMemo(() => {
    const now = Date.now();
    return followUps
      .filter(isOpen)
      .sort((left, right) => {
        const overdueDelta = Number(isOverdue(right, now)) - Number(isOverdue(left, now));
        if (overdueDelta) return overdueDelta;
        const priorityDelta = (PRIORITY_WEIGHT[right?.priority] || 0) - (PRIORITY_WEIGHT[left?.priority] || 0);
        if (priorityDelta) return priorityDelta;
        const leftDueAt = new Date(left?.due_at || "").getTime();
        const rightDueAt = new Date(right?.due_at || "").getTime();
        return (Number.isFinite(leftDueAt) ? leftDueAt : Number.MAX_SAFE_INTEGER) - (Number.isFinite(rightDueAt) ? rightDueAt : Number.MAX_SAFE_INTEGER);
      });
  }, [followUps]);

  const visibleItems = openItems.slice(0, maxItems);
  const overdueCount = openItems.filter((item) => isOverdue(item)).length;
  const hiddenCount = Math.max(0, openItems.length - visibleItems.length);
  const shouldExplainLimit = possiblyTruncated || hiddenCount > 0;

  return (
    <Card
      signal={overdueCount > 0 ? "attention" : openItems.length > 0 ? "recommendation" : "healthy"}
      className="overflow-hidden border-border/70 bg-[linear-gradient(135deg,hsl(var(--nx-surface-raised)/0.96),hsl(var(--nx-surface)/0.94))]"
      data-testid="client-portfolio-follow-ups"
    >
      <CardHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
              overdueCount > 0 ? "border-amber-400/25 bg-amber-400/10 text-amber-300" : "border-sky-400/20 bg-sky-400/[0.08] text-sky-300",
            )}>
              {overdueCount > 0 ? <AlertTriangle className="h-4.5 w-4.5" /> : <CalendarClock className="h-4.5 w-4.5" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">My account commitments</p>
                {!loading && openItems.length > 0 && <Badge variant="outline" className={cn(
                  "h-5 px-1.5 text-[9px] uppercase tracking-[0.12em]",
                  overdueCount > 0 ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-sky-400/25 bg-sky-400/[0.06] text-sky-200",
                )}>{overdueCount > 0 ? `${overdueCount} overdue` : `${openItems.length} open`}</Badge>}
              </div>
              <CardTitle className="mt-1 text-base">The customer promises you own next</CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">A focused cross-client view. Open the client record to update a commitment with its full account context.</p>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={load} disabled={loading} data-testid="refresh-client-portfolio-follow-ups">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 p-3 sm:p-4" aria-live="polite">
        {loadError ? (
          <div role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.045] px-4 py-4">
            <p className="text-sm font-medium text-foreground">Commitments could not be loaded</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Nothing has been changed. Retry when Nexus can reach the portfolio service.</p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />Retry loading commitments
            </Button>
          </div>
        ) : loading ? (
          <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-border/70 bg-muted/[0.12] text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />Loading your account commitments…
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/[0.12] px-5 py-7 text-center">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <p className="mt-2 text-sm font-medium text-foreground">No open account commitments</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Nexus will show the next customer promise assigned to you here, without duplicating client work.</p>
          </div>
        ) : visibleItems.map((item) => {
          const overdue = isOverdue(item);
          const highPriority = item.priority === "high";
          return (
            <article
              key={item.id || `${item.client_id}-${item.title}`}
              className={cn(
                "group rounded-xl border p-3.5 transition-colors",
                overdue ? "border-amber-400/30 bg-amber-400/[0.045]" : "border-border/70 bg-background/[0.42] hover:border-sky-400/25 hover:bg-muted/20",
              )}
              data-testid={`client-portfolio-follow-up-${item.id || "unknown"}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/25 text-muted-foreground"><Building2 className="h-3.5 w-3.5" /></span>
                    <p className="truncate text-sm font-semibold text-foreground">{item.title || "Untitled account commitment"}</p>
                    <Badge variant="outline" className={cn(
                      "h-5 px-1.5 text-[9px] uppercase tracking-[0.1em]",
                      overdue ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-sky-400/25 bg-sky-400/[0.06] text-sky-200",
                    )}>{overdue ? "Overdue" : "Open"}</Badge>
                    {highPriority && <span className="text-[10px] font-semibold text-amber-300">High priority</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{item.client_name || "Client record"}</span>
                    <span className={cn("inline-flex items-center gap-1.5", overdue && "text-amber-200")}>
                      {overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{dueLabel(item.due_at)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 capitalize"><UserRound className="h-3.5 w-3.5" />{item.owner_name || "You"} · {readableKind(item.kind)}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-primary/25 bg-primary/[0.06] text-primary hover:bg-primary/[0.12]"
                  onClick={() => onOpenClient?.(item.client_id)}
                  disabled={!item.client_id || !onOpenClient}
                  data-testid={`open-follow-up-client-${item.id || "unknown"}`}
                >
                  Open client<ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </article>
          );
        })}
        {shouldExplainLimit && !loadError && !loading && (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">Showing the most urgent commitments first. Open the related client record for the complete register.</p>
        )}
      </CardContent>
    </Card>
  );
}
