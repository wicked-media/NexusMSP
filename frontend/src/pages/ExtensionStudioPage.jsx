import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  AlertTriangle,
  Blocks,
  CheckCircle2,
  FileCode2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  capabilityRows,
  checkStateLabel,
  checkTone,
  exampleManifestText,
  formatCheckSummary,
  marketplaceState,
  parseManifest,
  sortChecks,
  verdictLabel,
  verdictTone,
} from "@/lib/extensionStudio";

/**
 * `/extension-studio` — a governed way to add Nexus-native capability.
 *
 * The page makes one honest claim: it *reviews* a manifest. It does not build,
 * sign, deploy or execute anything, and the approval label says so on screen.
 * Marketplace distribution is shown as deferred with its gate, because that is
 * what it is.
 */

const TONE_CLASS = {
  emerald: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  zinc: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const CHECK_ICON = {
  pass: CheckCircle2,
  needs_review: AlertTriangle,
  fail: XCircle,
};

function CheckRow({ check }) {
  const tone = checkTone(check?.state);
  const state = String(check?.state || "").trim().toLowerCase();
  const Icon = CHECK_ICON[state] || ShieldAlert;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/40 last:border-b-0" data-testid={`check-${check?.id}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium">{check?.label || check?.id}</p>
        <p className="text-[11px] text-muted-foreground">{check?.reason}</p>
      </div>
      <Badge variant="outline" className={`ml-auto text-[9px] whitespace-nowrap ${TONE_CLASS[tone]}`}>
        {checkStateLabel(check?.state)}
      </Badge>
    </div>
  );
}

export default function ExtensionStudioPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [contract, setContract] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [manifestText, setManifestText] = useState(() => exampleManifestText());
  const [refusal, setRefusal] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [sendError, setSendError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [contractRes, capabilitiesRes] = await Promise.all([
        axios.get(`${API}/extensions/contract`, { headers }),
        axios.get(`${API}/extensions/capabilities`, { headers }),
      ]);
      setContract(contractRes.data);
      setCapabilities(capabilitiesRes.data);
    } catch (err) {
      setLoadError(apiErrorMessage(err, "The extension contract could not be loaded."));
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const validate = useCallback(async () => {
    setSendError(null);
    setResult(null);
    const parsed = parseManifest(manifestText);
    if (!parsed.ok) {
      // Refused in the browser: broken JSON is never sent to a permissioned endpoint.
      setRefusal(parsed.error);
      return;
    }
    setRefusal(null);
    setSending(true);
    try {
      const res = await axios.post(`${API}/extensions/validate`, { manifest: parsed.manifest }, { headers });
      setResult(res.data);
    } catch (err) {
      setSendError(apiErrorMessage(err, "The manifest could not be reviewed. Nothing has been changed."));
    } finally {
      setSending(false);
    }
  }, [headers, manifestText]);

  const marketplace = useMemo(() => marketplaceState(contract), [contract]);
  const capped = useMemo(
    () => capabilityRows(capabilities?.capabilities, 60),
    [capabilities],
  );
  const orderedChecks = useMemo(() => sortChecks(result?.checks), [result]);

  if (loadError) {
    return (
      <div className="space-y-4" data-testid="extension-studio-error">
        <OperationalPageHeader
          eyebrow="Platform · foundation"
          title="Extension Studio"
          description={loadError}
          icon={ShieldAlert}
          tone="amber"
        />
        <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Retry</Button>
      </div>
    );
  }

  if (!contract || !capabilities) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading the extension contract…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="extension-studio">
      <OperationalPageHeader
        eyebrow="Platform · one operating model"
        title="Extension Studio"
        description="Review a Nexus-native extension manifest against the routes Nexus actually serves, the permission catalogue and a declared isolation, verification and rollback plan."
        icon={Blocks}
        tone="cyan"
        actions={<Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>}
      />

      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Marketplace distribution</p>
            <Badge variant="outline" className={`text-[9px] ${TONE_CLASS.amber}`}>{marketplace.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{marketplace.detail}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4" />
            <p className="text-sm font-semibold">Extension manifest</p>
            <span className="text-[11px] text-muted-foreground">API {contract.api_version} · kinds: {contract.kinds.join(", ")}</span>
          </div>
          <textarea
            data-testid="manifest-editor"
            aria-label="Extension manifest JSON"
            className="w-full min-h-[16rem] rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed"
            value={manifestText}
            onChange={(event) => { setManifestText(event.target.value); setRefusal(null); }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={validate} disabled={sending} data-testid="validate-manifest">
              {sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldAlert className="w-4 h-4 mr-1" />}
              Review manifest
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Approval here is a review outcome. It deploys nothing, grants no privilege and builds no code.
            </span>
          </div>
          {refusal && (
            <p className="text-xs text-amber-500" data-testid="manifest-refusal">
              {refusal} Nothing was sent to the server.
            </p>
          )}
          {sendError && <p className="text-xs text-rose-400" data-testid="validate-error">{sendError}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Review outcome</p>
              <Badge variant="outline" className={`text-[10px] ${TONE_CLASS[verdictTone(result.verdict)]}`} data-testid="verdict">
                {verdictLabel(result.verdict)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{formatCheckSummary(result.checks_summary)}</p>
            {Array.isArray(result.missing_fields) && result.missing_fields.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Missing required field(s): {result.missing_fields.join(", ")}
              </p>
            )}
            <div data-testid="check-results">
              {orderedChecks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No check result was returned, so none is claimed.</p>
              ) : (
                orderedChecks.map((check) => <CheckRow key={check?.id || check?.label} check={check} />)
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{result.boundary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Composable capabilities</p>
            <span className="text-[11px] text-muted-foreground">
              {capped.total} served route{capped.total === 1 ? "" : "s"}
            </span>
          </div>
          {capped.total === 0 ? (
            <p className="text-xs text-muted-foreground">
              This Nexus is serving no composable /api capability, so a manifest can declare none.
            </p>
          ) : (
            <>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border/60" data-testid="capability-list">
                {capped.rows.map((capability) => (
                  <div key={capability.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 last:border-b-0">
                    <span className="font-mono text-[11px] truncate">{capability.id}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {(capability.methods || []).join(" ")}{capability.mutating ? " · mutating" : ""}
                    </span>
                  </div>
                ))}
              </div>
              {capped.hidden > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Showing the first {capped.rows.length} of {capped.total}; {capped.hidden} more are served.
                </p>
              )}
            </>
          )}
          <p className="text-[11px] text-muted-foreground">{capabilities.boundary}</p>
        </CardContent>
      </Card>
    </div>
  );
}
