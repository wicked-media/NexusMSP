import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

/**
 * The shared evidence kit for a Studio tab that adopts an existing projection.
 *
 * A studio whose capability is already served by a scoped endpoint does not get
 * a second dashboard: its tab reads that endpoint and renders it, so the studio
 * and the workspace can never disagree. This kit is the honest half of that —
 * the disclosure line, the totals, the rows, and the not-reported value — and
 * each studio's panel supplies only the field mapping it modelled from the
 * API's payload.
 *
 * The rules are the fleet's (docs/NEXUS_STUDIO_FLEET.md, Law 9) and this file
 * is where they are mechanically enforced for these tabs:
 *
 * 1. **The registry decides the request.** The endpoint and its declared
 *    `params` come from the studio contract; the browser never guesses a
 *    parameter the registry left unbound (and refuses to request at all if one
 *    is left over).
 * 2. **A missing value is "not reported", never zero and never blank.** The
 *    API's own `null`/absent field renders as an explicit disclosure, so an
 *    unmeasured dimension cannot be mistaken for a clean one.
 * 3. **An empty read is stated, not styled as good news.** An empty list says
 *    what it means for this projection rather than rendering as a healthy
 *    nothing.
 * 4. **No panel paraphrases a number it does not model.** Anything the panel
 *    does not name stays in the API's payload, unedited, and the endpoint is
 *    always printed so a technician can read the source.
 */

/** Substitute the values the registry declared for a tab's endpoint. */
export function resolveObservationEndpoint(endpoint, params) {
  let path = String(endpoint || "");
  for (const [key, value] of Object.entries(params || {})) {
    path = path.split(`{${key}}`).join(encodeURIComponent(value));
  }
  return path;
}

/**
 * Which adopted projection an endpoint answers, or null when it is not one of
 * them. The endpoint still decides: a studio that pointed its tab at something
 * else renders through the generic endpoint tab, not through a panel whose
 * field mapping would not describe it.
 */
export function studioObservationView(endpoint) {
  const path = String(endpoint || "");
  if (path === "/devices") return "device-estate";
  if (path === "/nexus-agent/agents") return "agent-fleet";
  if (path === "/clients-enriched") return "client-estate";
  if (path === "/backup-dashboard/overview") return "backup-recovery";
  if (path === "/m365/tenants") return "m365-tenants";
  if (path === "/yeastar/pbxs") return "voice-estate";
  if (path === "/web-studio/fleet") return "web-estate";
  if (path === "/networking/sites") return "network-sites";
  if (path === "/patch-compliance/overview") return "patch-posture";
  if (path === "/security-dashboard/overview") return "security-posture";
  if (path === "/leads") return "lead-pipeline";
  if (path === "/documentation") return "documentation-inventory";
  if (path === "/csat/dashboard") return "communications-csat";
  return null;
}

/** Read the endpoint a tab's registry contract names, with its declared params. */
export function useStudioObservation(spec) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const endpoint = resolveObservationEndpoint(spec?.endpoint, spec?.params);
  // The registry refuses an unbound placeholder at import, so this is
  // unreachable through the API. It is checked anyway: the failure mode being
  // prevented is a request to a path no route answers, and silently requesting
  // a literal "{platform}" would be that same bug in a new place.
  const unresolved = /\{[a-z_]+\}/.test(endpoint);
  const [state, setState] = useState({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    if (!endpoint || unresolved) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await axios.get(`${API}${endpoint}`, { headers });
      setState({ loading: false, data: res.data, error: null });
    } catch (err) {
      setState({
        loading: false,
        data: null,
        error: apiErrorMessage(
          err,
          "This projection did not answer, so this studio is not observing anything here.",
        ),
      });
    }
  }, [endpoint, unresolved, headers]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, endpoint, unresolved };
}

/** A value the API did not report, said out loud instead of shown as blank. */
export function NotReported({ what }) {
  return (
    <span className="text-muted-foreground italic" data-testid="observation-not-reported">
      Not reported{what ? ` (${what})` : ""}
    </span>
  );
}

/** Render an observed value, or the not-reported disclosure when it is absent. */
export function Observed({ value, what }) {
  const empty = value === null || value === undefined || value === "";
  return empty ? <NotReported what={what} /> : <>{value}</>;
}

export function ObservationLoading({ label = "Reading observed data…", testId = "studio-observation-loading" }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6" data-testid={testId}>
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

export function ObservationError({ error, onRetry, testId = "studio-observation-error" }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5" data-testid={testId}>
      <CardContent className="pt-4 flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">{error}</p>
        {onRetry && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onRetry}>
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The header every adopted projection renders: which endpoint answered, the
 * registry's own summary of the capability, and a refresh.
 */
export function ObservationHeader({ studio, spec, endpoint, onRefresh, testId = "studio-observation-header" }) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" />
          Reads <span className="font-mono">{endpoint}</span> — observed data with server-side tenant
          and client scope.
        </p>
        {onRefresh && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3 mr-1" />Refresh
          </Button>
        )}
      </div>
      {spec?.summary && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{spec.summary}</p>
      )}
      {studio?.name && (
        <p className="text-[11px] text-muted-foreground">
          This is the projection {studio.name} was admitted against, not a second store of it.
        </p>
      )}
    </div>
  );
}

/** Counted facts about what was observed. A null total is not-reportable. */
export function ObservedTotals({ totals, testId = "studio-observation-totals" }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid={testId}>
      {totals.map((total) => (
        <Card key={total.label}>
          <CardContent className="pt-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{total.label}</p>
            <p className="text-lg font-medium" data-testid={`observation-total-${total.label}`}>
              <Observed value={total.value} />
            </p>
            {total.detail && <p className="text-[11px] text-muted-foreground">{total.detail}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** One observed record. Every field the panel models is named or not-reported. */
export function ObservedRows({ rows, testId = "studio-observation-rows", label }) {
  if (!rows.length) return null;
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-4 space-y-1">
        {label && (
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{label}</p>
        )}
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-wrap items-center gap-3 text-xs py-1.5 border-b border-border/40 last:border-0"
            data-testid={`observation-row-${row.key}`}
          >
            <span className={`w-2 h-2 rounded-full ${row.dotClass || "bg-slate-500"}`} />
            <span className="font-medium">{row.label}</span>
            {row.meta.length > 0 && (
              <span className="text-muted-foreground">{row.meta.map((part, index) => (
                <span key={`${row.key}-meta-${index}`}>{index > 0 ? " · " : ""}{part}</span>
              ))}</span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {row.status && <span className="uppercase mr-2">{row.status}</span>}
              <Observed value={row.observedAt} what="observation time" />
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** An empty observation, said in this projection's terms. */
export function ObservedEmpty({ title, note, testId = "studio-observation-empty" }) {
  return (
    <Card className="border-dashed" data-testid={testId}>
      <CardContent className="pt-5 max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{note}</p>
      </CardContent>
    </Card>
  );
}

/** The boundary this projection carries, in the API's or the panel's words. */
export function ObservationNote({ children, testId = "studio-observation-note" }) {
  if (!children) return null;
  return (
    <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid={testId}>
      {children}
    </p>
  );
}

/** A tab whose contract leaves a value unbound requests nothing and says why. */
export function ObservationUnbound({ spec }) {
  return (
    <Card className="border-dashed" data-testid="studio-observation-unbound">
      <CardContent className="pt-5 max-w-2xl">
        <p className="text-sm font-medium mb-1">
          This tab&apos;s contract does not name what it reads
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The endpoint <span className="font-mono">{spec?.endpoint}</span> carries a value the
          registry never declared, so Nexus has nothing to read and requests nothing.
        </p>
      </CardContent>
    </Card>
  );
}

/** Trust/health tone for a row dot, from a status the API reported. */
export function statusDot(status, tones) {
  const key = String(status || "").toLowerCase();
  return (tones || {})[key] || "bg-slate-500";
}
