import { Navigate } from "react-router-dom";

/** Keeps existing links working while QBR creation now has one workspace. */
export default function QBRRedirectPage() {
  return <Navigate to="/qbr" replace />;
}
