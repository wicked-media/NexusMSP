import { Navigate } from "react-router-dom";

/** Redirects retired aliases without exposing a second route for the same workspace. */
export default function LegacyRouteRedirectPage({ redirectTo = "/" }) {
  return <Navigate to={redirectTo} replace />;
}
