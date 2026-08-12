import { useEffect, useState } from "react";
import { EyeOff, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "nexus-privacy-curtain";

/**
 * A share-safe mode for demos, support calls, and screenshots. Individual
 * screens opt sensitive values in with data-sensitive rather than attempting
 * to imply that unknown content has been redacted.
 */
export default function NexusPrivacyCurtain() {
  const [active, setActive] = useState(() => localStorage.getItem(STORAGE_KEY) === "active");

  useEffect(() => {
    if (active) {
      document.documentElement.dataset.privacyCurtain = "active";
    } else {
      delete document.documentElement.dataset.privacyCurtain;
    }
    localStorage.setItem(STORAGE_KEY, active ? "active" : "inactive");

    return () => {
      delete document.documentElement.dataset.privacyCurtain;
    };
  }, [active]);

  useEffect(() => {
    const toggle = () => setActive((current) => !current);
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        toggle();
      }
    };

    window.addEventListener("nexus:toggle-privacy-curtain", toggle);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("nexus:toggle-privacy-curtain", toggle);
      window.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  const setCurtain = (next) => {
    setActive(next);
    toast.success(next
      ? "Privacy Curtain enabled — marked Nexus fields are masked."
      : "Privacy Curtain disabled.");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setCurtain(!active)}
        className={`fixed bottom-5 right-5 z-[80] inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-2xl backdrop-blur transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active
          ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100 shadow-cyan-950/50"
          : "border-border/70 bg-background/85 text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}
        aria-pressed={active}
        title="Toggle Privacy Curtain (Ctrl+Shift+P)"
        data-testid="privacy-curtain-toggle"
      >
        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Privacy</span>
      </button>

      {active && (
        <div
          className="fixed left-1/2 top-4 z-[90] flex w-[min(92vw,38rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-cyan-300/25 bg-slate-950/90 px-3 py-2.5 text-slate-100 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl"
          role="status"
          aria-live="polite"
          data-testid="privacy-curtain-status"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide">Privacy Curtain active</p>
            <p className="mt-0.5 text-[11px] text-slate-300">Marked client and device fields are masked for safe sharing.</p>
          </div>
          <kbd className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-[10px] text-slate-300 md:block">Ctrl Shift P</kbd>
          <button
            type="button"
            onClick={() => setCurtain(false)}
            className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            aria-label="Disable Privacy Curtain"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
