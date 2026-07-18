import { Navigate } from "react-router-dom";

export default function TechRosterRedirectPage() {
  return <Navigate to="/team-hub?tab=roster" replace />;
}
