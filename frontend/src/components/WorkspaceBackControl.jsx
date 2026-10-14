import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { getWorkspaceBackNavigation } from "@/lib/workspaceBackNavigation";

/**
 * A deterministic in-app way out of a nested Nexus view.
 *
 * This intentionally resolves a known Nexus parent instead of using browser
 * history: a technician can open a deep link in a new tab without getting a
 * surprising or external destination when they leave it.
 */
export default function WorkspaceBackControl({ to, label, show = true, className = "" }) {
  const location = useLocation();
  const inferredNavigation = useMemo(
    () => getWorkspaceBackNavigation({ pathname: location.pathname, search: location.search }),
    [location.pathname, location.search],
  );
  const navigation = !show ? null : to ? { to, label: label || "Back" } : inferredNavigation;

  if (!navigation) return null;

  return (
    <Link
      to={navigation.to}
      className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${className}`}
      data-testid="workspace-header-back"
    >
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {navigation.label}
    </Link>
  );
}
