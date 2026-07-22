import { Link } from "react-router-dom";
import { BookOpen, KeyRound, ShieldCheck } from "lucide-react";

/**
 * Consistent in-context help for any credentialed setup flow.
 * Keep it beside the inputs: technicians should not have to leave a setup task
 * to discover prerequisites, the credential source, or how to validate it.
 */
export default function SetupGuideCallout({ title = "Before you connect", source, steps = [], securityNote, helpSlug }) {
  return <aside className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-3 text-xs text-muted-foreground" data-testid="setup-guide-callout">
    <div className="flex gap-2"><div className="mt-0.5 rounded-md bg-sky-500/10 p-1"><KeyRound className="h-3.5 w-3.5 text-sky-300" /></div><div><p className="font-medium text-sky-100">{title}</p>{source && <p className="mt-1">{source}</p>}</div></div>
    {steps.length > 0 && <ol className="mt-2 space-y-1 pl-5 text-muted-foreground">{steps.map((step, index) => <li className="list-decimal" key={`${index}-${step}`}>{step}</li>)}</ol>}
    {securityNote && <p className="mt-2 flex gap-1.5 border-t border-sky-500/15 pt-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />{securityNote}</p>}
    {helpSlug && <Link to={`/help/${helpSlug}`} className="mt-2 inline-flex items-center gap-1 text-sky-300 hover:underline"><BookOpen className="h-3.5 w-3.5" />Open the technician setup guide</Link>}
  </aside>;
}
