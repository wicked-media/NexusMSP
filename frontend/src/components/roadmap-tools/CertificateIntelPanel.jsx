import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw, ShieldAlert, CalendarClock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const RISK_TONE = {
  expired: "border-red-500/40 text-red-200",
  critical: "border-red-400/30 text-red-200",
  high: "border-orange-400/30 text-orange-200",
  medium: "border-amber-400/30 text-amber-200",
  low: "border-slate-400/30 text-slate-200",
  ok: "border-emerald-400/25 text-emerald-100",
  unknown: "border-slate-500/30 text-slate-300",
};

/**
 * Certificate & Domain Intelligence (roadmap #489/#493, merged into the
 * Exposure workspace). Derived read model over retained domain/certificate
 * evidence: expiry risk bands, dangerous-change review, and the accountable
 * portfolio view. Unknown expiry is never shown as safe.
 */
export default function CertificateIntelPanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [portfolio, setPortfolio] = useState(null);
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [portfolioResponse, changesResponse] = await Promise.all([
        axios.get(`${API}/certificate-intel/portfolio`, { headers }),
        axios.get(`${API}/certificate-intel/dangerous-changes`, { headers }),
      ]);
      setPortfolio(portfolioResponse.data);
      setChanges(changesResponse.data?.changes || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Certificate intelligence could not load");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const review = async (change) => {
    setBusy(`${change.record_id}-${change.kind}`);
    try {
      await axios.post(`${API}/certificate-intel/changes/review`, {
        record_id: change.record_id,
        kind: change.kind,
        client_id: change.client_id || null,
        outcome: "reviewed",
      }, { headers });
      toast.success("Review recorded — the source records stay authoritative.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Review could not be recorded");
    } finally {
      setBusy("");
    }
  };

  const counts = portfolio?.portfolio?.counts || {};

  return (
    <Card className="rounded-2xl border-border/60 bg-background/65" data-testid="cert-intel-panel">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />Certificate &amp; Domain Intelligence
          </p>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={load} data-testid="cert-intel-refresh">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh
          </Button>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading evidence…</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5" data-testid="cert-intel-bands">
              {["expired", "critical", "high", "medium", "low", "ok", "unknown"].map((band) => (
                <Badge key={band} variant="outline" className={RISK_TONE[band]}>
                  {band}: {counts[band] ?? 0}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              <CalendarClock className="mr-1 inline h-3 w-3" />
              {portfolio?.portfolio?.soonest_expiries?.length
                ? `Soonest: ${portfolio.portfolio.soonest_expiries[0].name} (${portfolio.portfolio.soonest_expiries[0].days_remaining} days)`
                : "No expiry evidence recorded yet."}
            </p>

            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Dangerous changes awaiting review</p>
              {changes.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground" data-testid="cert-intel-no-changes">Nothing awaiting review.</p>
              ) : (
                <div className="mt-2 space-y-2" data-testid="cert-intel-changes">
                  {changes.slice(0, 6).map((change) => (
                    <div key={`${change.record_id}-${change.kind}`} className="rounded-lg border border-border/50 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-foreground">{change.name} — {change.kind.replace(/_/g, " ")}</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{change.explanation}</p>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy === `${change.record_id}-${change.kind}`}
                          onClick={() => review(change)} data-testid={`cert-intel-review-${change.kind}`}>
                          <CheckCircle2 className="mr-1 h-3 w-3" />Mark reviewed
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
