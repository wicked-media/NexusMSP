import { Navigate } from "react-router-dom";

/** Revenue Growth is the single home for detected and managed opportunities. */
export default function UpsellRedirectPage() {
  return <Navigate to="/growth" replace />;
}
