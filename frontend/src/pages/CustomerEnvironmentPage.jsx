import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Activity, Building2, Link2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  candidateStrength,
  correlationHeadline,
  groupDimensions,
  healthTone,
  minutesBeforeLabel,
  sharedTargetLabel,
  signalChips,
} from "@/lib/customerEnvironment";

/**
 * `/customer-environment` — the Nexus Customer Environment Studio.
 *
 * One customer's whole operating environment in one place: the disclosed estate
 * counts, the evidence signals, and the "what changed, and could it explain
 * today's tickets" correlation.
 *
 * Two honesty rules are enforced in the rendering, not just the backend:
 * a dimension the server did not measure renders "Not measured" with its reason
 * (never a reassuring zero), and a correlation is presented as a candidate the
 * technician must judge — never as a cause.
 */

const TONE_STYLE = {
  emerald: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  zinc: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  slate: "bg-slate-500/10 text-slate-300 border-slate-500/20",
};

const toneClass = (tone) => TONE_STYLE[tone] || TONE_STYLE.zinc;

const INVESTIGATION_WINDOW_HOURS = 24;

export default function CustomerEnvironmentPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [investigation, setInvestigation] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      const response = await axios.get(`${API}/customer-environment/summary`, { headers });
      const clients = response.data?.clients || [];
      setSummary({ ...response.data, clients });
      setSelectedId((current) => current || clients[0]?.client_id || null);
    } catch (err) {
      setSummaryError(apiErrorMessage(err, "The customer environment list could not be loaded."));
    }
  }, [headers]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const loadDetail = useCallback(async (clientId) => {
    if (!clientId) return;
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const [overview, correlation] = await Promise.all([
        axios.get(`${API}/customer-environment/${clientId}`, { headers }),
        axios.get(`${API}/customer-environment/${clientId}/investigation`, {
          headers,
          params: { window_hours: INVESTIGATION_WINDOW_HOURS },
        }),
      ]);
      setCustomer(overview.data);
      setInvestigation(correlation.data);
    } catch (err) {
      setCustomer(null);
      setInvestigation(null);
      setDetailError(apiErrorMessage(err, "This customer's environment could not be loaded."));
    } finally {
      setLoadingDetail(false);
    }
  }, [headers]);

  useEffect(() => { loadDetail(selectedId); }, [loadDetail, selectedId]);

  const groups = useMemo(() => (customer ? groupDimensions(customer) : []), [customer]);
  const chips = useMemo(() => (customer ? signalChips(customer) : []), [customer]);
  const health = useMemo(() => healthTone(customer?.health?.state), [customer]);
  const candidates = investigation?.candidates || [];

  if (summaryError) {
    return (
      <div className="space-y-4" data-testid="customer-environment-error">
        <OperationalPageHeader
          eyebrow="Platform · one customer view"
          title="Customer Environment"
          description={summaryError}
          icon={ShieldAlert}
          tone="amber"
        />
        <Button variant="outline" onClick={loadSummary}>
          <RefreshCw className="w-4 h-4 mr-1" />Retry
        </Button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10" data-testid="customer-environment-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading customer environments…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="customer-environment">
      <OperationalPageHeader
        eyebrow="Platform · one customer view"
        title="Customer Environment"
        description={`${summary.count} customer${summary.count === 1 ? "" : "s"} in scope. Estate, evidence and open work combined across domains — an unmeasured dimension is disclosed, never shown as zero.`}
        icon={Building2}
        tone="cyan"
        actions={
          <Button variant="outline" onClick={() => { loadSummary(); loadDetail(selectedId); }}>
            <RefreshCw className="w-4 h-4 mr-1" />Refresh
          </Button>
        }
      />

      {summary.clients.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground" data-testid="customer-environment-empty">
              No customer is inside your scope, so there is no environment to show. That is an empty
              result, not a healthy estate.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" data-testid="customer-environment-clients">
            {summary.clients.map((client) => (
              <Button
                key={client.client_id}
                size="sm"
                variant={client.client_id === selectedId ? "default" : "outline"}
                className="h-8 text-xs"
                data-testid={`environment-client-${client.client_id}`}
                onClick={() => setSelectedId(client.client_id)}
              >
                {client.client_name || client.client_id}
              </Button>
            ))}
          </div>

          {detailError && (
            <Card>
              <CardContent className="pt-4" data-testid="customer-environment-detail-error">
                <p className="text-sm text-amber-500">{detailError}</p>
              </CardContent>
            </Card>
          )}

          {loadingDetail && !customer && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading this customer's environment…
            </div>
          )}

          {customer && (
            <>
              <Card data-testid="customer-environment-health">
                <CardContent className="pt-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Environment health</p>
                    <p className="font-semibold text-sm mt-1">{customer.client_name || customer.client_id}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {customer.health?.reason || health.description}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${toneClass(health.tone)}`}>
                    {health.label}
                  </Badge>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-3" data-testid="customer-environment-groups">
                {groups.map((group) => (
                  <Card key={group.key} data-testid={`environment-group-${group.key}`}>
                    <CardContent className="pt-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">{group.label}</p>
                      <div className="space-y-3">
                        {group.items.map((item) => (
                          <div key={item.id} data-testid={`environment-dimension-${item.id}`}>
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-xs text-muted-foreground">{item.label}</p>
                              {item.display.assessed ? (
                                <p className="text-lg font-semibold tabular-nums">{item.display.text}</p>
                              ) : (
                                <Badge variant="outline" className={`text-[9px] ${toneClass(item.display.tone)}`}>
                                  {item.display.text}
                                </Badge>
                              )}
                            </div>
                            {!item.display.assessed && (
                              <p className="text-[11px] text-muted-foreground mt-1">{item.display.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card data-testid="customer-environment-signals">
                <CardContent className="pt-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Evidence in force</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {chips.map((chip) => (
                      <div key={chip.id} className="rounded-lg border border-border/60 p-3" data-testid={`environment-signal-${chip.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">{chip.label}</p>
                          <Badge variant="outline" className={`text-[9px] ${toneClass(chip.presentation.tone)}`}>
                            {chip.presentation.label}
                          </Badge>
                        </div>
                        {chip.reason ? (
                          <p className="text-[11px] text-muted-foreground mt-1">{chip.reason}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="customer-environment-investigation">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Activity className="w-4 h-4 mt-0.5 text-cyan-400" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold">
                        {investigation?.question || "What changed in this customer's environment, and could any of those changes explain today's tickets?"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1" data-testid="environment-correlation-headline">
                        {correlationHeadline(investigation)}
                      </p>
                    </div>
                  </div>

                  {candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="environment-no-candidates">
                      No change and open ticket in this window shared an identifier, so nothing is reported
                      as a contributor.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {candidates.map((candidate) => {
                        const strength = candidateStrength(candidate.strength);
                        return (
                          <li
                            key={`${candidate.change_id}-${candidate.ticket_id}`}
                            className="rounded-lg border border-border/60 p-3"
                            data-testid={`environment-candidate-${candidate.change_id}-${candidate.ticket_id}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium">{candidate.change_title || candidate.change_id}</p>
                              <Badge variant="outline" className={`text-[9px] ${toneClass(strength.tone)}`}>
                                {strength.label}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {candidate.change_status ? `${candidate.change_status} · ` : ""}
                              {minutesBeforeLabel(candidate.minutes_before_ticket)} ticket{" "}
                              {candidate.ticket_title || candidate.ticket_id}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                              <Link2 className="w-3 h-3" aria-hidden="true" />
                              {sharedTargetLabel(candidate.shared_targets)}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-1">{candidate.basis}</p>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <p className="text-[11px] text-muted-foreground border-t border-border/60 pt-2" data-testid="environment-boundary">
                    {investigation?.boundary}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      <p className="text-[11px] text-muted-foreground">{summary.boundary}</p>
    </div>
  );
}
