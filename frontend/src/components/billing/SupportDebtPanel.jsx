import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Repeat, RefreshCw } from "lucide-react";
import {
  SUPPORT_DEBT_WINDOWS,
  costBasis,
  formatHours,
  formatMoney,
  formatWindow,
  lastSeenLabel,
  signaturePressure,
  supportDebtHeadline,
} from "@/lib/supportDebt";

const TONES = {
  emerald: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-200",
  amber: "border-amber-500/25 bg-amber-500/[0.07] text-amber-200",
  rose: "border-rose-500/25 bg-rose-500/[0.07] text-rose-200",
  zinc: "border-white/10 bg-white/[0.03] text-zinc-400",
};

/**
 * Nexus Support Debt — work the MSP repeats because a source is still broken.
 *
 * The figure is derived from ticket recurrence and recorded labour only. Nexus
 * never invents a rate: when value was not recorded, the row shows hours and says
 * so, because "$0 of avoidable labour" and "no rate recorded" are different
 * statements to a manager.
 */
export default function SupportDebtPanel({ headers, defaultWindowDays = 90 }) {
  const [windowDays, setWindowDays] = useState(defaultWindowDays);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (days) => {
    setLoading(true);
    try {
      const { data: payload } = await axios.get(`${API}/support-debt/overview?window_days=${days}`, { headers });
      setData(payload);
    } catch {
      toast.error("Nexus could not read the recurring-work evidence.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(windowDays); }, [load, windowDays]);

  const totals = data?.totals;
  const signatures = data?.signatures || [];

  return (
    <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] via-card to-rose-500/[0.02]" data-testid="support-debt-panel">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Repeat className="h-4 w-4 text-amber-300" />Nexus Support Debt
          </CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="support-debt-headline">
            {supportDebtHeadline(totals)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="support-debt-window">Observed over</label>
          <select
            id="support-debt-window"
            className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-400/40"
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
            data-testid="support-debt-window"
          >
            {SUPPORT_DEBT_WINDOWS.map((option) => (
              <option key={option} value={option} className="bg-[#0d1117]">{formatWindow(option)}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={() => load(windowDays)} disabled={loading} data-testid="support-debt-refresh">
            <RefreshCw className={`mr-1.5 h-3 w-3 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="support-debt-totals">
          <div className="rounded-lg border border-white/[0.08] bg-black/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recurring patterns</p>
            <p className="text-lg font-semibold text-zinc-100">{totals?.signatures ?? 0}</p>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-black/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Repeats observed</p>
            <p className="text-lg font-semibold text-zinc-100">{totals?.recurring_tickets ?? 0}</p>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-black/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Annual labour</p>
            <p className="text-lg font-semibold text-zinc-100">{formatHours(totals?.annual_hours)}</p>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-black/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Annual recorded value</p>
            <p className="text-lg font-semibold text-zinc-100" data-testid="support-debt-annual-cost">{formatMoney(totals?.annual_cost)}</p>
            {totals?.uncosted_signatures > 0 && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {totals.uncosted_signatures} pattern(s) counted in hours only
              </p>
            )}
          </div>
        </div>

        {signatures.length === 0 && !loading && (
          <p className="rounded-lg border border-white/[0.07] bg-black/10 p-3 text-xs text-muted-foreground" data-testid="support-debt-empty">
            Nothing repeats often enough to be called support debt in this window. Nexus needs to see the same work
            shape at least {data?.min_occurrences ?? 4} times before it reports a pattern.
          </p>
        )}

        {signatures.length > 0 && (
          <ul className="space-y-2" data-testid="support-debt-signatures">
            {signatures.map((signature) => {
              const basis = costBasis(signature.cost_basis);
              const tone = signaturePressure(signature);
              return (
                <li
                  key={`${signature.client_id}-${signature.signature}`}
                  className="rounded-lg border border-white/[0.07] bg-black/10 p-3"
                  data-testid={`support-debt-${signature.signature.replace(/ /g, "-")}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-100">{signature.label}</span>
                    <Badge variant="outline" className="border-white/10 text-[10px] text-zinc-300">
                      {signature.client_name || signature.client_id || "Unassigned client"}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${TONES[tone]}`} data-testid="support-debt-repeats">
                      {signature.occurrences} repeats
                    </Badge>
                    <span className="ml-auto text-xs font-semibold text-amber-200">
                      {formatHours(signature.annual_hours)}/yr · {formatMoney(signature.annual_cost)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {formatHours(signature.hours)} recorded inside {formatWindow(signature.window_days)} · {lastSeenLabel(signature)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${TONES[basis.tone]}`} data-testid="support-debt-basis">{basis.label}</Badge>
                    {signature.categories?.length > 0 && (
                      <span className="text-[10px] capitalize text-muted-foreground">{signature.categories.join(", ")}</span>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-zinc-300">{signature.source_fix}</p>
                </li>
              );
            })}
          </ul>
        )}

        {data?.boundary && <p className="text-[10px] leading-4 text-muted-foreground">{data.boundary}</p>}
      </CardContent>
    </Card>
  );
}
