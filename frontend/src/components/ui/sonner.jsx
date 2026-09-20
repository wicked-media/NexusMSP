import { useEffect, useState } from "react"
import { Toaster as Sonner, toast } from "sonner"
import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert } from "lucide-react"

const DEFAULT_TOAST_PREFS = {
  toast_position: "top-right",
  toast_style: "nexus",
  toast_duration: 4500,
  toast_density: "comfortable",
};

const readToastPrefs = () => {
  try { return { ...DEFAULT_TOAST_PREFS, ...JSON.parse(localStorage.getItem("nexus-toast-preferences") || "{}") }; }
  catch { return DEFAULT_TOAST_PREFS; }
};

const Toaster = ({ ...props }) => {
  const [preferences, setPreferences] = useState(readToastPrefs);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");

  useEffect(() => {
    const refresh = () => setPreferences(readToastPrefs());
    const themeObserver = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || "dark"));
    window.addEventListener("nexus-toast-preferences", refresh);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("nexus-toast-preferences", refresh);
      themeObserver.disconnect();
    };
  }, []);

  const styleClass = preferences.toast_style === "minimal"
    ? "!rounded-lg !border-border/80 !bg-card !shadow-lg"
    : preferences.toast_style === "compact"
      ? "!rounded-lg !border-border/80 !bg-card !shadow-xl"
      : "!rounded-xl !border-border/80 !bg-card/95 !shadow-[0_20px_54px_-28px_rgba(0,0,0,0.9)] !backdrop-blur-xl";
  const densityClass = preferences.toast_density === "compact"
    ? "!min-h-0 !gap-2 !px-3 !py-2.5 !text-xs"
    : "!min-h-0 !gap-3 !px-3.5 !py-3 !text-sm";

  return (
    <Sonner
      theme={theme}
      position={preferences.toast_position}
      duration={Number(preferences.toast_duration) || DEFAULT_TOAST_PREFS.toast_duration}
      visibleToasts={preferences.toast_density === "compact" ? 2 : 3}
      closeButton
      expand={false}
      richColors={false}
      gap={10}
      offset={16}
      icons={{
        success: <CheckCircle2 className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <CircleAlert className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: `nx-toast group toast !overflow-hidden !text-foreground ${styleClass} ${densityClass}`,
          content: "!min-w-0 !gap-1",
          title: "!text-[13px] !font-semibold !leading-5 !tracking-[-0.01em]",
          description: "!text-xs !leading-[1.5] !text-muted-foreground",
          icon: "nx-toast__icon !flex !h-8 !w-8 !shrink-0 !self-center !items-center !justify-center !rounded-[10px] !border !border-current/15 !bg-current/[0.08]",
          closeButton: "nx-toast__close !inline-flex !h-6 !w-6 !items-center !justify-center !rounded-md !border-border/70 !bg-card/80 !text-muted-foreground hover:!bg-muted hover:!text-foreground",
          actionButton: "!h-7 !rounded-md !bg-primary !px-2.5 !text-[11px] !font-semibold !text-primary-foreground hover:!brightness-110",
          cancelButton: "!h-7 !rounded-md !bg-muted !px-2.5 !text-[11px] !font-medium !text-muted-foreground hover:!bg-accent hover:!text-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
