import { Activity, ArrowRight, CircleAlert, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

/** A quiet, always-available read on the estate. It only summarises retained nav evidence. */
export default function NexusGlobalPulse({ counts = {}, collapsed = false }) {
  const navigate = useNavigate();
  const meta = counts._meta || {};
  const attention = [meta.breached, meta.critical, meta.offline, meta.warning, meta.alerts]
    .reduce((total, value) => total + (Number(value) || 0), 0);
  const nominal = attention === 0;
  const label = nominal ? "All systems nominal" : `${attention} situation${attention === 1 ? "" : "s"} need attention`;

  return <button
    type="button"
    onClick={() => navigate("/")}
    className={`nexus-global-pulse ${nominal ? "is-nominal" : "needs-attention"} ${collapsed ? "is-collapsed" : ""}`}
    aria-label={`Nexus Global Pulse: ${label}. Open Mission Control.`}
    data-testid="nexus-global-pulse"
  >
    <span className="nexus-global-pulse__orb" aria-hidden="true">{nominal ? <ShieldCheck /> : <CircleAlert />}</span>
    {!collapsed && <span className="min-w-0 text-left"><span className="nexus-global-pulse__eyebrow"><Activity />Nexus Global Pulse</span><strong>{label}</strong><small>{nominal ? "The estate is calm on current evidence" : "Open Mission Control to investigate"}</small></span>}
    {!collapsed && <ArrowRight className="nexus-global-pulse__arrow" aria-hidden="true" />}
  </button>;
}
