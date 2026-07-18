import { Navigate } from "react-router-dom";

export default function CredentialsTabRedirectPage({ redirectTab = "vault" }) {
  return <Navigate to={`/credentials?tab=${redirectTab}`} replace />;
}
