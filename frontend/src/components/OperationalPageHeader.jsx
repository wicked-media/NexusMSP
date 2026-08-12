/**
 * Standard page header for operational tools that are not part of a module hub.
 * Keep titles, descriptions, and primary actions in one predictable treatment.
 */
export default function OperationalPageHeader({ eyebrow = "Operations", title, description, icon: Icon, actions, tone = "violet", signal, className = "" }) {
  const tones = {
    violet: "border-violet-500/20 from-violet-500/[0.10]",
    sky: "border-sky-500/20 from-sky-500/[0.10]",
    emerald: "border-emerald-500/20 from-emerald-500/[0.10]",
    amber: "border-amber-500/20 from-amber-500/[0.10]",
  };
  const iconTones = { violet: "text-violet-300", sky: "text-sky-300", emerald: "text-emerald-300", amber: "text-amber-300" };
  return (
    <section className={`nx-page-stage ${signal ? "nx-ambient-surface" : ""} rounded-2xl border bg-gradient-to-br ${tones[tone] || tones.violet} via-background to-background p-5 md:p-6 ${className}`} data-nx-signal={signal}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${iconTones[tone] || iconTones.violet}`}>{eyebrow}</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {Icon && <Icon className={`h-6 w-6 ${iconTones[tone] || iconTones.violet}`} />}{title}
          </h1>
          {description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}
