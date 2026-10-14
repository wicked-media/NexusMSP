import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Activity, ChevronRight, CircleAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API } from "@/App";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildEstateStatus } from "@/lib/estateStatus";

const statusIcon = {
  healthy: ShieldCheck,
  stable: ShieldCheck,
  warning: TriangleAlert,
  critical: CircleAlert,
  neutral: Activity,
};

export default function EstateStatus({ token, collapsed = false }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [phase, setPhase] = useState("loading");
  const hasStatus = useRef(false);

  const fetchStatus = useCallback(async (signal) => {
    if (!token) {
      setPhase("unavailable");
      return;
    }

    try {
      const response = await axios.get(`${API}/mission-control/overview`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        timeout: 8000,
      });
      setSummary(response.data?.summary || null);
      setPhase(response.data?.summary ? "ready" : "unavailable");
      hasStatus.current = Boolean(response.data?.summary);
    } catch (error) {
      if (error?.code !== "ERR_CANCELED" && !hasStatus.current) setPhase("unavailable");
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    // Authentication changes define a new visibility boundary. Never retain an
    // estate summary from the previous session while the new scope is loading.
    hasStatus.current = false;
    setSummary(null);
    setPhase("loading");
    fetchStatus(controller.signal);
    const refreshTimer = window.setInterval(() => fetchStatus(controller.signal), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(refreshTimer);
    };
  }, [fetchStatus]);

  const status = useMemo(() => buildEstateStatus(summary, phase), [phase, summary]);
  const StatusIcon = statusIcon[status.tone];
  const ariaLabel = status.score === null
    ? `Estate status: ${status.label}. Open Mission Control.`
    : `Estate status: ${status.label}, health score ${status.score} out of 100. Open Mission Control.`;

  const control = (
    <button
      type="button"
      onClick={() => navigate("/")}
      className={`nexus-estate-status is-${status.tone} ${collapsed ? "is-collapsed" : ""}`}
      aria-label={ariaLabel}
      data-testid="estate-status"
    >
      <span className="nexus-estate-status__icon" aria-hidden="true"><StatusIcon /></span>
      {!collapsed && (
        <>
          <span className="nexus-estate-status__copy">
            <span>Estate status</span>
            <strong>{status.detail}</strong>
          </span>
          <ChevronRight className="nexus-estate-status__arrow" aria-hidden="true" />
        </>
      )}
    </button>
  );

  if (!collapsed) return control;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="right">Estate status · {status.detail}</TooltipContent>
    </Tooltip>
  );
}
