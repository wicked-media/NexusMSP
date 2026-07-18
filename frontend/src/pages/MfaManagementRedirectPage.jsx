import { Navigate } from "react-router-dom";

export default function MfaManagementRedirectPage() {
  return <Navigate to="/credentials?tab=mfa-management" replace />;
}
