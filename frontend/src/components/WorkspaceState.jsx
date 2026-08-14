import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Consistent workspace loading and recovery language. Core pages should never
 * leave a technician with an ambiguous spinner or an un-actionable failure.
 */
export function WorkspaceLoadingState({ label = "Loading workspace", className = "" }) {
  return (
    <div className={`space-y-5 ${className}`} role="status" aria-live="polite" data-testid="workspace-loading-state">
      <div className="h-28 animate-pulse rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.08] via-background to-transparent" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {["one", "two", "three", "four"].map((key) => <Card key={key} className="overflow-hidden"><CardContent className="p-5"><div className="h-14 animate-pulse rounded-xl bg-muted/60" /></CardContent></Card>)}
      </div>
      <p className="text-center text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function WorkspaceErrorState({ title = "Workspace data is unavailable", description, onRetry, retryLabel = "Retry", className = "" }) {
  return (
    <Card className={`mx-auto mt-10 max-w-2xl border-rose-500/30 bg-rose-500/[0.045] ${className}`} data-testid="workspace-error-state">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-500/[0.1]"><AlertTriangle className="h-6 w-6 text-rose-300" /></span>
        <div><h1 className="text-lg font-semibold">{title}</h1><p className="mt-1 max-w-lg text-sm text-muted-foreground">{description || "Nexus could not retrieve the information needed for this workspace. No work has been changed."}</p></div>
        {onRetry && <Button onClick={onRetry} data-testid="workspace-retry"><RefreshCw className="mr-2 h-4 w-4" />{retryLabel}</Button>}
      </CardContent>
    </Card>
  );
}
