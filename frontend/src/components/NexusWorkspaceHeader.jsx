import { Children, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Activity, AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

import WorkspaceBackControl from "@/components/WorkspaceBackControl";
import { getWorkspaceBackNavigation } from "@/lib/workspaceBackNavigation";
import { normaliseWorkspaceSignal } from "@/lib/nexusWorkspaceHeader";

const SIGNAL_STATES = {
  healthy: {
    label: "Workspace ready",
    description: "Connected evidence is available for this workspace.",
    icon: CheckCircle2,
  },
  working: {
    label: "Work in progress",
    description: "Live operational work is present in this workspace.",
    icon: Activity,
  },
  attention: {
    label: "Review required",
    description: "Review the current evidence before high-impact work.",
    icon: AlertTriangle,
  },
  critical: {
    label: "Immediate attention",
    description: "A recorded signal requires technician review.",
    icon: AlertTriangle,
  },
  neutral: {
    label: "Status unavailable",
    description: "No current operational state has been supplied.",
    icon: CircleDashed,
  },
};

/**
 * Canonical Nexus workspace identity and action surface.
 *
 * Keep this component presentation-only: callers remain responsible for
 * permission-aware actions and truthful operational signals.
 */
export default function NexusWorkspaceHeader({
  eyebrow = "Operations",
  title,
  description,
  icon: Icon,
  actions,
  actionsLabel = "Workspace actions",
  actionsDescription = "Common controls for this workspace.",
  tone = "violet",
  signal,
  signalLabel,
  signalDescription,
  meta,
  className = "",
  backTo,
  backLabel,
  showBack = true,
  variant = "workspace",
  testId = "nexus-workspace-header",
}) {
  const location = useLocation();
  const inferredBack = useMemo(
    () => getWorkspaceBackNavigation({ pathname: location.pathname, search: location.search }),
    [location.pathname, location.search],
  );
  const backNavigation = backTo === false || !showBack
    ? null
    : backTo
      ? { to: backTo, label: backLabel || "Back" }
      : inferredBack;
  const signalState = normaliseWorkspaceSignal(signal);
  const status = SIGNAL_STATES[signalState];
  const SignalIcon = status.icon;
  const hasSignal = Boolean(signal);
  const actionCount = Children.count(actions);
  const metaItems = Array.isArray(meta) ? meta.filter(Boolean) : [];

  return (
    <section
      className={`nx-workspace-header nx-workspace-header--${variant} ${actions || hasSignal ? "" : "nx-workspace-header--solo"} ${className}`}
      data-tone={tone}
      data-signal-state={signalState}
      data-nx-signal={signal || undefined}
      data-testid={testId}
    >
      <div className="nx-workspace-header__identity">
        {Icon && (
          <span className="nx-workspace-header__mark" aria-hidden="true">
            <Icon />
            {hasSignal && <i className="nx-workspace-header__orb" />}
          </span>
        )}
        <div className="nx-workspace-header__copy">
          {backNavigation && <WorkspaceBackControl to={backNavigation.to} label={backNavigation.label} className="nx-workspace-header__back" />}
          <p className="nx-workspace-header__eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {description && <p className="nx-workspace-header__description">{description}</p>}
          {metaItems.length > 0 && (
            <div className="nx-workspace-header__meta">
              {metaItems.map((item, index) => <span key={item?.key || index}>{item}</span>)}
            </div>
          )}
        </div>
      </div>

      {(actions || hasSignal) && (
        <aside className="nx-workspace-header__aside" data-has-signal={hasSignal ? "true" : "false"} data-action-count={actionCount}>
          {hasSignal && (
            <div className="nx-workspace-header__state">
              <span className="nx-workspace-header__state-icon" aria-hidden="true"><SignalIcon /></span>
              <div>
                <p>{signalLabel || status.label}</p>
                <small>{signalDescription || status.description}</small>
              </div>
            </div>
          )}
          {actions && (
            <div className="nx-workspace-header__command-rail">
              {(actionsLabel || actionsDescription) && <div className="nx-workspace-header__action-copy">
                {actionsLabel && <p>{actionsLabel}</p>}
                {actionsDescription && <small>{actionsDescription}</small>}
              </div>}
              <div className="nx-workspace-header__actions">{actions}</div>
            </div>
          )}
        </aside>
      )}
    </section>
  );
}
