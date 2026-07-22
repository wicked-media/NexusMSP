import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const TechCommandCenter = lazy(() => import("./TechCommandCenter"));
const LEGACY_TAB_DESTINATIONS = {
  technicians: { tab: "command", view: "directory" },
  utilization: { tab: "command", view: "capacity" },
  roster: { tab: "command", view: "roster" },
  skills: { tab: "command", view: "skills" },
  leaderboard: { tab: "command", view: "leaderboard" },
};

export default function TeamHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const legacyDestination = LEGACY_TAB_DESTINATIONS[tab];
    if (legacyDestination) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", legacyDestination.tab);
      nextParams.set("view", legacyDestination.view);
      setSearchParams(nextParams, { replace: true });
      return;
    }
  }, [searchParams, setSearchParams]);

  return (
    <Suspense fallback={<div className="p-12 text-sm text-muted-foreground">Loading Team Command…</div>}>
      <TechCommandCenter />
    </Suspense>
  );
}
