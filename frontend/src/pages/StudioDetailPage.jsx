import { useParams } from "react-router-dom";
import StudioShell from "@/components/studios/StudioShell";

/**
 * `/studios/:studioId` — one route per Studio, all rendered by the shared
 * spine so a studio is a registry entry rather than a parallel product.
 */
export default function StudioDetailPage() {
  const { studioId } = useParams();
  return <StudioShell studioId={studioId} />;
}
