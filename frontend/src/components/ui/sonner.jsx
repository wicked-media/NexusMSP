import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
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
  const { theme = "system" } = useTheme()
  const [preferences, setPreferences] = useState(readToastPrefs);

  useEffect(() => {
    const refresh = () => setPreferences(readToastPrefs());
    window.addEventListener("nexus-toast-preferences", refresh);
    return () => window.removeEventListener("nexus-toast-preferences", refresh);
  }, []);

  const styleClass = preferences.toast_style === "minimal"
    ? "!rounded-lg !border-zinc-700/80 !bg-zinc-950 !shadow-xl"
    : preferences.toast_style === "compact"
      ? "!rounded-lg !border-violet-500/25 !bg-zinc-950/95 !shadow-lg"
      : "!rounded-xl !border-violet-500/25 !bg-zinc-950/95 !shadow-[0_18px_45px_-24px_rgba(139,92,246,0.85)] !backdrop-blur-xl";
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
            `group toast !text-zinc-100 ${styleClass} ${densityClass}`,
          description: "!mt-1 !text-zinc-400",
          actionButton: "!rounded-md !bg-violet-500 !text-white hover:!bg-violet-400",
          cancelButton: "!rounded-md !bg-zinc-800 !text-zinc-300 hover:!bg-zinc-700",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
