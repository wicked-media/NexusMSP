/**
 * Shared treatment for search, filters, results and compact queue controls.
 * Keep primary actions in the workspace header; use this component only for
 * the controls that help a technician narrow or present the current view.
 */
export default function WorkspaceControlBar({ children, className = "", ...props }) {
  return (
    <section
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/35 px-3 py-2.5 shadow-sm backdrop-blur-sm dark:border-white/[0.08] dark:bg-black/[0.14] ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}
