import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  Observed,
  ObservedEmpty,
  ObservedRows,
  ObservedTotals,
  useStudioObservation,
} from "./StudioObservationKit";

const SECURITY_LABELS = {
  open_alerts: "Open Defender alerts", high_alerts: "High-severity alerts", identity_risks: "Identity risks",
  conditional_access_policies: "Conditional Access policies", report_only_policies: "Report-only policies", defender_devices_at_risk: "Defender devices at risk",
};

function Readiness({ data }) {
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  return <>
    <ObservedTotals totals={[
      { label: "Connection", value: data?.connection?.configured ? "Configured" : "Not configured", detail: "Credential presence only; it is not a confirmed provider connection." },
      { label: "Evidence streams", value: streams.filter((stream) => stream.status === "evidence_active").length, detail: `${streams.length} declared streams; a missing stream is never assumed healthy.` },
    ]} />
    {streams.length ? <div className="grid gap-2 md:grid-cols-2">{streams.map((stream) => <div key={stream.id} className="rounded-xl border border-border/70 bg-card p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{stream.label}</p><Badge variant={stream.status === "evidence_active" ? "secondary" : "outline"} className="text-[10px]">{stream.status.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{stream.records} provider record(s)</p><p className="mt-2 text-[11px] text-muted-foreground">Permissions: {stream.permissions.join(", ")}</p><p className="mt-1 text-[11px] text-muted-foreground">Feeds: {stream.feeds.join(" · ")}</p></div>)}</div> : <ObservedEmpty title="No Microsoft evidence streams are declared" note="Collector readiness could not return a declared stream, so Nexus makes no Microsoft coverage claim." />}
    <ObservationNote>{data?.boundary}</ObservationNote>
  </>;
}

function Security({ data }) {
  const summary = data?.summary || {};
  const attention = Array.isArray(data?.attention) ? data.attention : [];
  return <>
    <ObservedTotals totals={Object.entries(SECURITY_LABELS).map(([key, label]) => ({ label, value: summary[key], detail: "Provider-recorded evidence only; not reported means this stream is unavailable." }))} />
    {attention.length ? <ObservedRows label="Recorded security attention" rows={attention.map((item) => ({ key: item.id || `${item.kind}-${item.subject}`, label: item.subject, meta: [<Observed key="detail" value={item.detail} what="detail" />, <Observed key="tenant" value={item.tenant_id} what="tenant" />], status: item.severity, observedAt: item.observed_at }))} /> : <ObservedEmpty title="No security attention record is in this scoped projection" note="This is not a clean-estate verdict. It means this endpoint has no recorded attention rows; review evidence-stream coverage before drawing a conclusion." />}
    {Array.isArray(data?.required_evidence) && <ObservationNote>Required evidence not yet recorded: {data.required_evidence.join(" · ")}</ObservationNote>}
    <ObservationNote>{data?.boundary}</ObservationNote>
  </>;
}

function Licensing({ data }) {
  const summary = data?.summary || {};
  const attention = Array.isArray(data?.attention) ? data.attention : [];
  return <>
    <ObservedTotals totals={[
      { label: "Reported SKUs", value: summary.skus, detail: "Provider-recorded licence SKU records in scope." },
      { label: "Active users", value: summary.active_users, detail: "Users the provider recorded as enabled." },
      { label: "Unlicensed active users", value: summary.unlicensed_active, detail: "Only active accounts with an explicit empty provider licence assignment." },
      { label: "Disabled licensed users", value: summary.disabled_licensed, detail: "A review signal, never an automatic licence removal." },
      { label: "Low-stock SKUs", value: summary.low_stock_skus, detail: "Provider records with two or fewer seats remaining." },
    ]} />
    {attention.length ? <ObservedRows label="Licence review signals" rows={attention.map((item) => ({ key: item.id || `${item.kind}-${item.subject}`, label: item.subject, meta: [<Observed key="detail" value={item.detail} what="detail" />, <Observed key="tenant" value={item.tenant_id} what="tenant" />], status: item.severity, observedAt: null }))} /> : <ObservedEmpty title="No provider-recorded licence review signal is in scope" note="This is not a billing reconciliation or a claim that all accounts are correctly licensed. It only reflects the evidence this projection received." />}
    <ObservationNote>{data?.boundary}</ObservationNote>
  </>;
}

export default function MicrosoftEvidencePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;
  const readiness = endpoint === "/m365/sync/readiness";
  const security = endpoint === "/m365/security/posture";
  const licensing = endpoint === "/m365/licensing/posture";
  return <div className="space-y-4" data-testid="studio-microsoft-evidence">
    <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
    {loading && <ObservationLoading label="Reading Microsoft provider evidence…" />}
    {!loading && error && <ObservationError error={error} onRetry={reload} />}
    {!loading && !error && readiness && <Readiness data={data} />}
    {!loading && !error && security && <Security data={data} />}
    {!loading && !error && licensing && <Licensing data={data} />}
    {!loading && !error && !readiness && !security && !licensing && <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground"><ShieldAlert className="mr-2 inline h-4 w-4" />This Microsoft projection is not yet modelled by this panel.</div>}
  </div>;
}
