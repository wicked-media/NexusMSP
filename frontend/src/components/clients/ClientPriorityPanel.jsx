import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Cloud,
  FileCheck2,
  HardDrive,
  Landmark,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getClientCoverageChecklist,
  getClientCoverageSummary,
  getClientPrimaryPriority,
} from "./clientPriorityHelpers";

const TONE_CLASSES = {
  rose: "border-rose-400/25 from-rose-500/[0.14] via-rose-500/[0.045] to-card/60",
  amber: "border-amber-400/25 from-amber-500/[0.14] via-amber-500/[0.045] to-card/60",
  cyan: "border-cyan-400/25 from-cyan-500/[0.14] via-cyan-500/[0.045] to-card/60",
  emerald: "border-emerald-400/25 from-emerald-500/[0.14] via-emerald-500/[0.045] to-card/60",
};

const TONE_ICON_CLASSES = {
  rose: "border-rose-300/25 bg-rose-400/10 text-rose-200",
  amber: "border-amber-300/25 bg-amber-400/10 text-amber-200",
  cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200",
  emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
};

const COVERAGE_ICONS = {
  contacts: Users,
  assets: HardDrive,
  agreements: FileCheck2,
  rmm: ShieldCheck,
  m365: Cloud,
  acronis: Landmark,
};

const STATUS_META = {
  complete: {
    label: "Ready",
    className: "border-emerald-400/25 bg-emerald-400/[0.09] text-emerald-200",
    icon: CheckCircle2,
  },
  attention: {
    label: "Needs setup",
    className: "border-amber-400/25 bg-amber-400/[0.09] text-amber-100",
    icon: ClipboardCheck,
  },
  unknown: {
    label: "Not confirmed",
    className: "border-border/70 bg-muted/25 text-muted-foreground",
    icon: CircleHelp,
  },
};

function actionAvailable(action, callbacks) {
  if (action.kind === "navigate") return typeof callbacks.onNavigate === "function";
  if (action.kind === "start-onboarding") return typeof callbacks.onStartOnboarding === "function";
  if (action.kind === "continue-onboarding") return typeof callbacks.onContinueOnboarding === "function";
  if (action.kind === "edit-profile") return typeof callbacks.onEditProfile === "function";
  return false;
}

function runAction(action, callbacks) {
  if (action.kind === "navigate") return callbacks.onNavigate?.(action.tab);
  if (action.kind === "start-onboarding") return callbacks.onStartOnboarding?.();
  if (action.kind === "continue-onboarding") return callbacks.onContinueOnboarding?.();
  if (action.kind === "edit-profile") return callbacks.onEditProfile?.();
  return undefined;
}

/**
 * Evidence-backed “Start here” panel for an opened client account.
 *
 * Navigation and workflow actions deliberately remain callbacks owned by the Client page.
 */
export default function ClientPriorityPanel({
  client,
  onboardingProgress,
  onNavigate,
  onStartOnboarding,
  onContinueOnboarding,
  onEditProfile,
}) {
  const callbacks = { onNavigate, onStartOnboarding, onContinueOnboarding, onEditProfile };
  const priority = getClientPrimaryPriority(client);
  const checklist = getClientCoverageChecklist(client);
  const coverage = getClientCoverageSummary(checklist);
  const coverageValue = coverage.known ? `${coverage.complete}/${coverage.known}` : "Awaiting evidence";
  const PriorityIcon = priority.id.includes("onboarding") ? Rocket : priority.tone === "rose" ? Landmark : priority.tone === "emerald" ? CheckCircle2 : ClipboardCheck;

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.35fr)]" data-testid="client-priority-panel">
      <article className={`nx-ambient-surface overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-[0_16px_42px_rgba(0,0,0,0.14)] ${TONE_CLASSES[priority.tone] || TONE_CLASSES.cyan}`} data-nx-signal={priority.tone === "rose" ? "critical" : priority.tone === "amber" ? "attention" : "healthy"}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Start here</p>
            <p className="mt-1 text-[11px] text-muted-foreground">One evidence-backed next step for {client?.name || "this client"}.</p>
          </div>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${TONE_ICON_CLASSES[priority.tone] || TONE_ICON_CLASSES.cyan}`}>
            <PriorityIcon className="h-5 w-5" />
          </span>
        </div>

        <div className="mt-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/85">{priority.eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{priority.title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{priority.description}</p>
          {priority.id === "continue-onboarding" && Number.isFinite(Number(onboardingProgress)) && (
            <p className="mt-3 inline-flex rounded-lg border border-cyan-300/15 bg-cyan-400/[0.06] px-2.5 py-1 text-[10px] font-medium text-cyan-100">{Math.max(0, Math.min(100, Math.round(Number(onboardingProgress))))}% of the onboarding plan is complete</p>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          className="mt-6 gap-1.5 shadow-sm"
          onClick={() => runAction(priority.action, callbacks)}
          disabled={!actionAvailable(priority.action, callbacks)}
          data-testid="client-priority-primary-action"
        >
          {priority.action.label}<ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </article>

      <article className="rounded-2xl border border-border/70 bg-card/35 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Setup & coverage</p>
            <h2 className="mt-1 text-base font-semibold text-foreground">What is connected to this account</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Each item opens the real client workspace where it can be checked or completed.</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 px-3 py-2 text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Coverage confirmed</p>
            <p className={coverage.known ? "mt-0.5 font-mono text-sm font-semibold text-foreground" : "mt-0.5 text-xs font-semibold text-foreground"}>{coverageValue}</p>
            {coverage.unknown > 0 && <p className="mt-0.5 text-[10px] text-muted-foreground">{coverage.unknown} not confirmed</p>}
          </div>
        </div>

        <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Client coverage checklist">
          {checklist.map((item, index) => {
            const Icon = COVERAGE_ICONS[item.id] || ClipboardCheck;
            const status = STATUS_META[item.status] || STATUS_META.unknown;
            const StatusIcon = status.icon;
            const action = { kind: "navigate", tab: item.tab, label: item.actionLabel };
            return (
              <li key={item.id} className="group flex min-w-0 flex-col rounded-xl border border-border/70 bg-background/30 p-3 transition duration-200 hover:border-primary/25 hover:bg-primary/[0.035]">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/25 text-muted-foreground group-hover:border-primary/20 group-hover:text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-foreground">{index + 1}. {item.label}</p>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] ${status.className}`}>
                        <StatusIcon className="h-2.5 w-2.5" />{status.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 w-full justify-between px-2 text-[11px] text-primary hover:bg-primary/[0.08] hover:text-primary"
                  onClick={() => runAction(action, callbacks)}
                  disabled={!actionAvailable(action, callbacks)}
                  data-testid={`client-coverage-action-${item.id}`}
                >
                  {item.actionLabel}<ArrowRight className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ol>
      </article>
    </section>
  );
}
