import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Shared shell for create, edit and approval workflows.
 *
 * It gives every operational form the same hierarchy: context, a clear title,
 * a restrained accent rail, a generous working area and a persistent action
 * zone. Individual workflows only provide their fields and actions.
 */
export default function NexusWorkflowDialog({
  eyebrow = "Nexus workflow",
  title,
  description,
  icon: Icon,
  children,
  footer,
  headerAccessory,
  className,
  contentClassName,
  tone = "cyan",
  ...props
}) {
  const tones = {
    cyan: "from-cyan-400/20 via-sky-400/5 to-transparent text-cyan-300",
    emerald: "from-emerald-400/20 via-teal-400/5 to-transparent text-emerald-300",
    violet: "from-violet-400/20 via-fuchsia-400/5 to-transparent text-violet-300",
    amber: "from-amber-400/20 via-orange-400/5 to-transparent text-amber-300",
  };
  const selectedTone = tones[tone] || tones.cyan;

  return (
    <DialogContent
      className={cn(
        "nx-workflow-dialog flex max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden border-primary/20 bg-[linear-gradient(145deg,hsl(var(--nx-surface-raised)/0.99),hsl(var(--nx-surface)/0.99))] p-0 sm:rounded-2xl",
        className,
      )}
      {...props}
    >
      <div className={`nx-workflow-dialog__header border-b border-border/70 bg-gradient-to-r ${selectedTone} px-5 py-5 pr-12 md:px-7`}>
        <div className="flex items-start gap-4">
          <DialogHeader className="min-w-0 flex-1 space-y-2 text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] opacity-90">{eyebrow}</p>
            <DialogTitle className="flex items-center gap-2 text-xl tracking-tight md:text-2xl">
              {Icon && <Icon className="h-5 w-5 shrink-0" />}
              {title}
            </DialogTitle>
            {description && <DialogDescription className="max-w-2xl text-left leading-6">{description}</DialogDescription>}
          </DialogHeader>
          {headerAccessory && <div className="hidden shrink-0 xl:block">{headerAccessory}</div>}
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-6", contentClassName)}>
        {children}
      </div>
      {footer && <DialogFooter className="nx-workflow-dialog__footer border-t border-border/70 bg-muted/[0.12] px-5 py-4 md:px-7">{footer}</DialogFooter>}
    </DialogContent>
  );
}
