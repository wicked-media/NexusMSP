import { Badge } from "@/components/ui/badge";
import {
  Boxes, CheckCircle2, FileText, Lock, Receipt, RotateCcw, ShieldCheck, Target,
} from "lucide-react";

const ADMISSION_FIELDS = [
  {
    key: "outcome",
    icon: Target,
    label: "Problem & outcome",
    value:
      "Account truth is spread across service, security and commercial records. This projection is admitted to shorten the path to the next safe client action, and must show when evidence is missing.",
  },
  {
    key: "objects",
    icon: Boxes,
    label: "Canonical objects & contracts",
    value:
      "Client, site, contact, device, contract, ticket and invoice IDs resolve through existing Nexus APIs. No unlinked copy is created and no provider is imitated.",
  },
  {
    key: "scope",
    icon: ShieldCheck,
    label: "Scope, audit & retention",
    value:
      "Admission requires an authenticated staff session, server-enforced tenant/client scope, attributable read audit and existing MongoDB retention. Frontend filtering is not a control.",
  },
  {
    key: "verification",
    icon: RotateCcw,
    label: "Verification & failure",
    value:
      "The projection is read-only. Missing or stale evidence is labelled, never inferred. Degraded relationships remain visible, and the last admitted projection is the rollback boundary.",
  },
  {
    key: "commercial",
    icon: Receipt,
    label: "Commercial truth",
    value:
      "Contracts and invoices remain the authoritative billing source. MRR and AR shown here are indicators, not billing assertions.",
  },
  {
    key: "gate",
    icon: CheckCircle2,
    label: "Release gate & owner",
    value:
      "R1 tenancy, audit and recovery gate; tenant-isolation and route regression tests; accountable owner recorded in the Master Capability Register.",
  },
];

/**
 * Admission contract for the Client Studio Overview projection.
 *
 * This is rendered above the projection rather than in a dialog so the studio
 * keeps the terms it adopted in view: canonical scope, evidence rules, the
 * commercial boundary and the release/rollback gate.
 */
export default function AdmissionContractBrief() {
  return (
    <section
      aria-labelledby="client-overview-admission-title"
      className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_38%),linear-gradient(135deg,rgba(8,30,41,0.62),rgba(11,13,18,0.92))] p-3 shadow-sm sm:p-4"
      data-testid="client-admission-contract-brief"
    >
      <div className="flex flex-col gap-2.5 sm:gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-200 sm:h-10 sm:w-10">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-300 sm:text-[10px]">Admission contract</p>
            <h2 id="client-overview-admission-title" className="mt-0.5 text-[15px] font-semibold leading-5 tracking-tight text-foreground sm:mt-1 sm:text-base">
              Client Overview projection
            </h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
              Adopted by this studio. These admission conditions stay above the projection so its scope, evidence rules and release boundary remain visible to everyone operating the account.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/[0.08] text-[9px] text-emerald-300 sm:text-[10px]">
            <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />Adopted
          </Badge>
          <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/[0.07] text-[9px] text-cyan-200 sm:text-[10px]">
            <Lock className="mr-1 h-3 w-3" aria-hidden="true" />Read-only projection
          </Badge>
        </div>
      </div>

      <dl className="mt-3 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.06] bg-black/15 sm:mt-4 sm:grid sm:grid-cols-2 sm:gap-2 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent xl:grid-cols-3">
        {ADMISSION_FIELDS.map(({ key, icon: Icon, label, value }) => (
          <div key={key} className="px-3 py-2 sm:rounded-xl sm:border sm:border-white/[0.06] sm:bg-black/15 sm:p-3" data-testid={`admission-condition-${key}`}>
            <dt className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-300/90">
              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
              {label}
            </dt>
            <dd className="mt-1 text-[10px] leading-4 text-zinc-300 sm:mt-1.5 sm:text-[11px] sm:leading-5">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2.5 text-[9px] leading-4 text-zinc-500 sm:mt-3 sm:text-[10px]">
        Source: Nexus Product Constitution · capability admission gate. This brief is retained with the projection and is not dismissible while the projection remains adopted.
      </p>
    </section>
  );
}
