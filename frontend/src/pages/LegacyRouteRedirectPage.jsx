import { Navigate, useLocation } from "react-router-dom";

/** Redirects retired aliases without exposing a second route for the same workspace. */
export default function LegacyRouteRedirectPage({ redirectTo = "/" }) {
  const location = useLocation();
  const [path, existingSearch = ""] = redirectTo.split("?");
  const targetParams = new URLSearchParams(existingSearch);
  const sourceParams = new URLSearchParams(location.search);
  sourceParams.forEach((value, key) => {
    if (!targetParams.has(key)) targetParams.set(key, value);
  });
  const search = targetParams.toString();
  return <Navigate to={`${path}${search ? `?${search}` : ""}`} replace />;
}
