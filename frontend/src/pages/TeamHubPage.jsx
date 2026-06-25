import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, UserCog, Users, CalendarDays, Activity, Target, Trophy } from "lucide-react";

const TABS = [
  { id: "command", label: "Command Center", icon: UserCog, page: () => import("./TechCommandCenter") },
  { id: "technicians", label: "Technicians", icon: Users, page: () => import("./TechniciansPage") },
  { id: "roster", label: "Roster", icon: CalendarDays, page: () => import("./TechRosterPage") },
  { id: "utilization", label: "Utilization", icon: Activity, page: () => import("./TechUtilizationPage") },
  { id: "skills", label: "Skills Matrix", icon: Target, page: () => import("./SkillsMatrixPage") },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy, page: () => import("./LeaderboardPage") },
];

const lazyMap = Object.fromEntries(TABS.map(t => [t.id, lazy(t.page)]));

export default function TeamHubPage() {
  const [activeTab, setActiveTab] = useState("command");

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
          <h1 className="text-2xl font-semibold tracking-tight">Team Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Command center, roster, utilization, skills and leaderboard — all the team views.</p>
        </div>
        <div className="px-4 mt-4 flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                data-testid={`team-hub-tab-${t.id}`}
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
