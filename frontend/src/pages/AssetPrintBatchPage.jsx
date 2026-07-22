import { Navigate } from "react-router-dom";

// QR Asset Tags is the canonical label workspace. Preserve old bookmarks
// without retaining a second, non-functional batch-print screen.
export default function AssetPrintBatchPage() {
  return <Navigate to="/qr-assets" replace />;
}
