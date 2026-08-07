import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrainCircuit, Loader2, Inbox, RefreshCw, Route, Sparkles, Wrench, Workflow, Activity, Bot, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TABS = [
  { id: "autopilot", label: "Autopilot", description: "Permission-based autonomy with explicit guardrails", icon: Bot, page: () => import("./AutopilotPage") },
  { id: "triage-queue", label: "Triage Queue", description: "Prioritise and own incoming work", icon: Inbox, page: () => import("./TriageQueuePage") },
  { id: "intelligent-routing", label: "Smart Routing", description: "Assign work by skill, availability and load", icon: Route, page: () => import("./IntelligentRoutingPage") },
  { id: "ai-resolution", label: "Auto-Resolve", description: "Review safe AI remediation proposals", icon: Sparkles, page: () => import("./AIResolutionPage") },
  { id: "self-healing", label: "Self-Healing", description: "Monitor and run approved recovery runbooks", icon: Wrench, page: () => import("./SelfHealingPage") },
  { id: "predictive", label: "Predictive", description: "Forecast hardware risk before an outage", icon: Activity, page: () => import("./PredictiveIntelPage") },
];

const lazyMap = Object.fromEntries(TABS.map(t => [t.id, lazy(t.page)]));

export default function AutoOpsHubPage() {
  const [activeTab, setActiveTab] = useState(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    return TABS.some(tab => tab.id === requestedTab) ? requestedTab : "autopilot";
  });
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    window.history.replaceState({}, "", url);
  }, [activeTab]);

  const Active = lazyMap[activeTab];

  return (
    <div className="space-y-5 p-6" data-testid="auto-ops-hub">
      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-[0_18px_55px_rgba(0,0,0,0.12)]" data-testid="auto-ops-header">
        <div className="flex flex-col gap-4 border-b border-border/60 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">AI intelligence</p>
            <div className="mt-1 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25"><BrainCircuit className="h-4.5 w-4.5 text-violet-300" /></span>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Operations</h1>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Triage, route, resolve and self-heal with explicit technician control and a complete operational trail.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live operations</Badge>
            <Button size="sm" variant="outline" onClick={() => navigate("/help/nexus-autopilot")} data-testid="auto-ops-help"><CircleHelp className="mr-1.5 h-3.5 w-3.5" />Guide</Button>
            <Button size="sm" variant="outline" onClick={() => setWorkspaceVersion(version => version + 1)} data-testid="auto-ops-refresh"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/automation-hub")} data-testid="auto-ops-workflows"><Workflow className="mr-1.5 h-3.5 w-3.5" />Automation</Button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 py-2" aria-label="AI Operations modules">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`auto-ops-tab-${tab.id}`} aria-current={selected ? "page" : undefined}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition ${selected ? "bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/25 dark:text-violet-200" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                <Icon className="h-3.5 w-3.5" />{tab.label}
              </button>
            );
          })}
        </nav>
      </section>
      <Suspense fallback={<div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading workspace...</div>}>
        <Active key={`${activeTab}-${workspaceVersion}`} embedded />
      </Suspense>
    </div>
  );
}
