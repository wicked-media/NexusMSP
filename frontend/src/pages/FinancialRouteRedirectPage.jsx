import { Navigate } from "react-router-dom";

export default function FinancialRouteRedirectPage({ redirectTo = "/financial-analytics" }) {
  return <Navigate to={redirectTo} replace />;
}
