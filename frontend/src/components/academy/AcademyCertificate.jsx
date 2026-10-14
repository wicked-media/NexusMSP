import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GraduationCap, ShieldCheck } from "lucide-react";

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
}

/**
 * Compact certificate tile for grids. `onOpen` shows the full sheet.
 */
export function AcademyCertificateCard({ certificate, onOpen }) {
  if (!certificate) return null;
  return (
    <div className="nx-enter flex flex-col rounded-xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.07] to-transparent p-4" data-testid={`academy-certificate-card-${certificate.id}`}>
      <div className="flex items-start justify-between gap-2">
        <Badge variant="outline" className="border-amber-400/30 bg-amber-400/[0.08] text-[9px] text-amber-200"><GraduationCap className="mr-1 h-3 w-3" />Certificate</Badge>
        <span className="text-[9px] text-muted-foreground">v{certificate.course_version || 1}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold text-zinc-100">{certificate.course_title || "Academy course"}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{certificate.learner_name || "Learner"} · Score {certificate.score_percent ?? 0}% · Issued {formatDate(certificate.issued_at)}</p>
      <p className="mt-2 font-mono text-[10px] tracking-wide text-amber-200/90">{certificate.verification_code}</p>
      {onOpen ? <Button size="sm" variant="outline" className="mt-3 h-7 border-amber-400/25 text-[11px]" onClick={() => onOpen(certificate)} data-testid={`academy-certificate-view-${certificate.id}`}>View certificate</Button> : null}
    </div>
  );
}

/**
 * The full certificate, styled for the screen and for print (`.nx-print-cert`).
 * This is retained learning evidence only — never professional certification.
 */
export function AcademyCertificateSheet({ certificate }) {
  if (!certificate) return null;
  return (
    <div className="nx-print-cert space-y-4 rounded-2xl border border-amber-400/30 bg-[radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.1),transparent_45%),linear-gradient(160deg,rgba(28,23,12,0.9),rgba(15,17,26,0.92))] p-6" data-testid="academy-certificate-sheet">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300">Nexus Academy</p>
          <p className="mt-1 text-lg font-semibold text-zinc-50">Certificate of Completion</p>
        </div>
        <ShieldCheck className="h-8 w-8 shrink-0 text-amber-300/80" />
      </div>
      <div className="space-y-1 rounded-xl border border-amber-400/20 bg-white/[0.03] p-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">This certifies that</p>
        <p className="text-base font-semibold text-zinc-50">{certificate.learner_name || "Learner"}</p>
        <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">has completed</p>
        <p className="text-base font-semibold text-zinc-50">{certificate.course_title || "Academy course"}{certificate.course_version ? <span className="ml-2 text-xs font-normal text-muted-foreground">version {certificate.course_version}</span> : null}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="border-amber-400/25 text-amber-100">Score {certificate.score_percent ?? 0}%</Badge>
        <Badge variant="outline" className="border-amber-400/25 text-amber-100">{certificate.correct_count ?? 0}/{certificate.question_count ?? 0} knowledge checks</Badge>
        <Badge variant="outline" className="border-amber-400/25 text-amber-100">Issued {formatDate(certificate.issued_at)}</Badge>
      </div>
      {certificate.completion_statement ? <p className="text-xs leading-5 text-muted-foreground">{certificate.completion_statement}</p> : null}
      <div className="space-y-1 rounded-xl border border-amber-400/20 bg-white/[0.02] p-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Verification code</p>
        <p className="font-mono text-sm tracking-[0.18em] text-amber-200">{certificate.verification_code}</p>
        <p className="mt-1 break-all font-mono text-[9px] leading-4 text-muted-foreground">Content fingerprint {certificate.content_hash ? `${certificate.content_hash.slice(0, 32)}…` : "—"}</p>
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">{certificate.evidence_boundary || "Nexus Academy retains learning-assignment and completion evidence only."}</p>
    </div>
  );
}
