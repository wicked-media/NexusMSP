import { Navigate } from "react-router-dom";

export default function ClientInsightsTabRedirectPage({ redirectTab = "portfolio-radar" }) {
  return <Navigate to={`/client-insights?tab=${redirectTab}`} replace />;
}
