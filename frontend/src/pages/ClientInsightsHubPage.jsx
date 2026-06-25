import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Users, HeartPulse, AlertTriangle, Smile, Activity } from "lucide-react";

const TABS = [
  { id: "customer-health", label: "Customer Health", icon: Users, page: () => import("./CustomerHealthPage") },
  { id: "client-health", label: "RMM Health", icon: HeartPulse, page: () => import("./ClientHealthPage") },
  { id: "client-risk", label: "Risk", icon: AlertTriangle, page: () => import("./ClientRiskPage") },
  { id: "sentiment", label: "Sentiment", icon: Smile, page: () => import("./SentimentDashboardPage") },
  { id: "client-timeline", label: "Timeline", icon: Activity, page: () => import("./ClientTimelinePage") },
];

const lazyMap = Object.fromEntries(TABS.map(t => [t.id, lazy(t.page)]));

export default function ClientInsightsHubPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("customer-health");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t && TABS.some(x => x.id === t)) setActiveTab(t);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    window.history.replaceState({}, "", url);
  }, [activeTab]);

  const Active = lazyMap[activeTab];

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card/50">
        <div className="px-6 pt-5">
          <h1 className="text-2xl font-semibold tracking-tight">Client Insights</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Unified view of client health, risk, sentiment and activity.</p>
        </div>
        <div className="px-4 mt-4 flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                data-testid={`client-insights-tab-${t.id}`}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                  active ? "bg-muted text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Suspense fallback={<div className="p-12 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}>
          <Active />
        </Suspense>
      </div>
    </div>
  );
}
