import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight, Compass, Lightbulb, PlayCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const WORKSPACES = [
  { match: (path) => path.startsWith("/tickets") || path.startsWith("/triage") || path.startsWith("/dispatch"), label: "Service desk", purpose: "Capture the request, establish the client and impact, then work from one accountable ticket.", next: "Create or claim a ticket", action: "/tickets", actionLabel: "Open ticket queue", guide: "/help/tickets" },
  { match: (path) => path.startsWith("/clients") || path.startsWith("/onboarding"), label: "Client operations", purpose: "Keep the customer record, services, people and onboarding evidence connected before making operational changes.", next: "Confirm the active client and complete the next onboarding gap", action: "/clients", actionLabel: "Open clients", guide: "/help/client-360" },
  { match: (path) => path.startsWith("/deployment") || path.startsWith("/channel-mode"), label: "Platform deployment", purpose: "Prepare a scoped deployment, activate it once, then wait for authenticated evidence before treating it as online.", next: "Prepare a customer Edge or review a pending activation", action: "/deployment-hub", actionLabel: "Open Deployment Hub", guide: "/help/nexus-agent-enrolment" },
  { match: (path) => path.startsWith("/nexus-shield") || path.startsWith("/security") || path.startsWith("/compliance"), label: "Security operations", purpose: "Review evidence first, choose the smallest safe response, and preserve verification before closing the work.", next: "Review the highest-confidence risk", action: "/nexus-shield", actionLabel: "Open Nexus Shield", guide: "/help/alert-rules" },
  { match: (path) => path.startsWith("/billing") || path.startsWith("/invoice") || path.startsWith("/purchase-order"), label: "Commercial operations", purpose: "Reconcile source evidence against the customer agreement before issuing or changing financial records.", next: "Review the next exception or record", action: "/billing-recon", actionLabel: "Open billing assurance", guide: "/help/invoices" },
  { match: (path) => path.startsWith("/documentation") || path.startsWith("/help"), label: "Knowledge & Docs", purpose: "Use a task-first guide, verify the live result, and retain the evidence needed for the next technician.", next: "Find the guide for the task in front of you", action: "/documentation-hub?tab=help", actionLabel: "Browse guides", guide: "/help/nexus-second-brain" },
];

const DEFAULT_WORKSPACE = { label: "Nexus workspace", purpose: "Start from the client context, understand the signal, then use the guided workflow for any action that changes a customer.", next: "Use the workspace's recommended action or search for the task", action: "/workspace", actionLabel: "Open my workspace", guide: "/documentation-hub?tab=help" };

/** A consistent, optional orientation layer for new technicians on every route. */
export default function NexusWorkspaceCompass() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const workspace = useMemo(() => WORKSPACES.find((item) => item.match(location.pathname)) || DEFAULT_WORKSPACE, [location.pathname]);

  return <>
    {!open && <button type="button" onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-xl border border-sky-400/25 bg-card/95 px-3 py-2 text-xs font-semibold text-sky-200 shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-300/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/50" aria-label="Open workspace guide" data-testid="workspace-compass-toggle"><Compass className="h-4 w-4" />Start here</button>}
    {open && <aside className="fixed bottom-4 left-4 z-40 w-[356px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-sky-400/25 bg-card/95 text-foreground shadow-2xl backdrop-blur-2xl" aria-label="Workspace guide" data-testid="workspace-compass-panel">
      <div className="border-b border-sky-400/15 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_58%)] p-4"><div className="flex items-start justify-between gap-3"><div className="flex gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-400/10 text-sky-200"><Compass className="h-4 w-4" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-200">New technician guide</p><h2 className="mt-1 text-base font-semibold">{workspace.label}</h2></div></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} aria-label="Close workspace guide"><X className="h-4 w-4" /></Button></div></div>
      <div className="space-y-4 p-4"><section><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">What this is for</p><p className="mt-1 text-sm leading-5 text-muted-foreground">{workspace.purpose}</p></section><section className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.055] p-3"><div className="flex gap-2"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><div><p className="text-xs font-semibold text-emerald-100">Recommended next step</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{workspace.next}</p></div></div></section><div className="grid grid-cols-2 gap-2"><Button size="sm" onClick={() => { setOpen(false); navigate(workspace.action); }}><PlayCircle className="mr-1.5 h-4 w-4" />{workspace.actionLabel}</Button><Button size="sm" variant="outline" asChild><Link to={workspace.guide} onClick={() => setOpen(false)}><BookOpen className="mr-1.5 h-4 w-4" />Open guide</Link></Button></div><p className="flex items-center gap-1 text-[10px] text-muted-foreground">Need something else? Use <kbd className="rounded border border-border bg-muted px-1">Ctrl K</kbd> to search people, devices, tickets and actions.<ChevronRight className="h-3 w-3" /></p></div>
    </aside>}
  </>;
}
