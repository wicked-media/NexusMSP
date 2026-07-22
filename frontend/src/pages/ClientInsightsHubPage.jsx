import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, Users, HeartPulse, AlertTriangle, Smile, Activity, Radar } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";

const TABS = [
  { id: "portfolio-radar", label: "Portfolio Radar", description: "Retention risks, healthy accounts, and growth signals across the portfolio.", icon: Radar, page: () => import("./HealthRadarPage") },
  { id: "customer-health", label: "Customer Health", description: "Composite customer scores from service, billing, and satisfaction signals.", icon: Users, page: () => import("./CustomerHealthPage") },
  { id: "client-health", label: "RMM Health", description: "Endpoint, service, and operational health across managed clients.", icon: HeartPulse, page: () => import("./ClientHealthPage") },
  { id: "client-risk", label: "Risk", description: "Client churn and commercial risk indicators requiring attention.", icon: AlertTriangle, page: () => import("./ClientRiskPage") },
  { id: "sentiment", label: "Sentiment", description: "Customer sentiment trends, recommendations, and analysis controls.", icon: Smile, page: () => import("./SentimentDashboardPage") },
  { id: "client-timeline", label: "Timeline", description: "One audited history for customer correspondence and operational activity.", icon: Activity, page: () => import("./ClientTimelinePage") },
];

const lazyMap = Object.fromEntries(TABS.map((tab) => [tab.id, lazy(tab.page)]));

export default function ClientInsightsHubPage() {
  const [activeTab, setActiveTab] = useState("portfolio-radar");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && TABS.some((tab) => tab.id === requested)) setActiveTab(requested);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    window.history.replaceState({}, "", url);
  }, [activeTab]);

  const Active = lazyMap[activeTab];
  const active = TABS.find((tab) => tab.id === activeTab) || TABS[0];
  const ActiveIcon = active.icon;

  return (
    <div className="space-y-5 p-4 md:p-6" data-testid="client-insights-hub">
      <OperationalPageHeader
        eyebrow="Client intelligence"
        title="Client Insights"
        description="Portfolio health, service risk, customer sentiment, and auditable activity in one controlled workspace."
        icon={Radar}
        tone="sky"
      />

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/55">
        <div className="border-b border-border/70 px-3 pt-3 md:px-4">
          <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Client Insights views">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`client-insights-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  className={`flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive ? "border-sky-400 bg-sky-500/[0.09] text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />{tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/[0.14] px-5 py-3">
          <ActiveIcon className="h-4 w-4 shrink-0 text-sky-300" />
          <p className="text-sm text-muted-foreground">{active.description}</p>
        </div>

        <Suspense fallback={<div className="flex items-center gap-2 p-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}>
          <Active embedded />
        </Suspense>
      </section>
    </div>
  );
}
