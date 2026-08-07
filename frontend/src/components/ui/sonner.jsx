import { useEffect, useState } from "react"
import { Toaster as Sonner, toast } from "sonner"

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
    ? "!rounded-lg !border-border !bg-card !shadow-xl"
    : preferences.toast_style === "compact"
      ? "!rounded-lg !border-primary/20 !bg-card/95 !shadow-lg"
      : "!rounded-xl !border-primary/25 !bg-card/95 !shadow-[0_18px_45px_-24px_hsl(var(--primary)/0.45)] !backdrop-blur-xl";
  const densityClass = preferences.toast_density === "compact" ? "!p-2 !text-xs" : "!p-4";

  return (
    <Sonner
      theme={theme}
      position={preferences.toast_position}
      duration={Number(preferences.toast_duration) || DEFAULT_TOAST_PREFS.toast_duration}
      visibleToasts={preferences.toast_density === "compact" ? 3 : 5}
      closeButton={preferences.toast_style !== "minimal"}
      expand={preferences.toast_style === "nexus"}
      richColors
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            `nx-toast group toast !text-foreground ${styleClass} ${densityClass}`,
          description: "!mt-1 !text-muted-foreground",
          actionButton: "!rounded-md !bg-primary !text-primary-foreground hover:!brightness-110",
          cancelButton: "!rounded-md !bg-muted !text-muted-foreground hover:!bg-accent hover:!text-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
