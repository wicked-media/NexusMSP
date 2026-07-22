import { Navigate } from "react-router-dom";

// QBR reporting now lives in the Reporting Hub with the rest of the
// evidence-backed client and executive outputs. Keep this route so saved links
// do not break, but never resurrect the former random-data generator.
export default function QBRGeneratorPage() {
  return <Navigate to="/reports?tab=clients" replace />;
}
