import { Badge } from "@/components/ui/badge";

export default function AcademyAssignmentEvidence({ assignments, currentVersion }) {
  if (!assignments?.length) return null;
  return <section className="space-y-3" aria-label="Assignment evidence">
    <div><h3 className="text-sm font-semibold">Learning history</h3><p className="mt-1 text-xs text-muted-foreground">Each assignment keeps the material and result for its own course version.</p></div>
    <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
      {assignments.map((row) => <div key={row.id} className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{row.learner_name || "Learner"}</span><div className="flex gap-2"><Badge variant="outline">v{row.course_version}{row.course_version !== currentVersion ? " · earlier" : ""}</Badge><Badge variant="outline" className={row.status === "completed" ? "text-emerald-300" : "text-amber-300"}>{row.status === "completed" ? "Completed" : "Assigned"}</Badge></div></div>
        <p className="text-xs text-muted-foreground">{row.completed_at ? `Completed ${new Date(row.completed_at).toLocaleString()}` : row.due_at ? `Due ${row.due_at}` : "No due date"}{row.completion_evidence?.question_count ? ` · Score ${row.completion_evidence.score_percent}%` : row.completed_at ? " · Acknowledgement" : ""}</p>
        {row.completion_evidence?.id && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Evidence reference</summary><p className="mt-2 break-all">{row.completion_evidence.id}</p><p className="mt-1 break-all">Material fingerprint: {row.completion_evidence.content_hash}</p></details>}
      </div>)}
    </div>
  </section>;
}
