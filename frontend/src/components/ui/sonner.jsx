import { useEffect, useState } from "react"
import { Toaster as Sonner, toast } from "sonner"
import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert } from "lucide-react"

const DEFAULT_TOAST_PREFS = {
  toast_position: "top-right",
  toast_style: "nexus",
  toast_duration: 4500,
  toast_density: "comfortable",
};

// The surface itself is owned by src/index.css, alongside the rest of the Nexus
// tokens. These maps only name the variant, and every stored preference falls
// back to a complete toast so an unknown value can never render an unstyled one.
const TOAST_STYLE_CLASS = {
  nexus: "nx-toast--nexus",
  minimal: "nx-toast--minimal",
  compact: "nx-toast--ops",
};
const TOAST_DENSITY_CLASS = {
  comfortable: "nx-toast--comfortable",
  compact: "nx-toast--dense",
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

  const styleClass = TOAST_STYLE_CLASS[preferences.toast_style] || TOAST_STYLE_CLASS.nexus;
  const densityClass = TOAST_DENSITY_CLASS[preferences.toast_density] || TOAST_DENSITY_CLASS.comfortable;

  return (
    <Sonner
      theme={theme}
      position={preferences.toast_position}
      duration={Number(preferences.toast_duration) || DEFAULT_TOAST_PREFS.toast_duration}
      visibleToasts={preferences.toast_density === "compact" ? 2 : 3}
      closeButton
      expand={false}
      richColors={false}
      // Sonner keeps what it is good at: timers, stacking, swipe and aria-live.
      // Project CSS owns every visual property. Sonner only turns its own styling
      // off when `unstyled` arrives with the toast options; otherwise its
      // runtime-injected theme rules outrank our stylesheet, so each tone has to
      // be declared twice and the icon chip silently loses its tint.
      unstyled
      gap={10}
      offset={16}
      icons={{
        success: <CheckCircle2 />,
        info: <Info />,
        warning: <TriangleAlert />,
        error: <CircleAlert />,
        loading: <LoaderCircle className="nx-toast__spinner" />,
      }}
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: `nx-toast ${styleClass} ${densityClass}`,
          content: "nx-toast__content",
          title: "nx-toast__title",
          description: "nx-toast__description",
          icon: "nx-toast__icon",
          closeButton: "nx-toast__close",
          actionButton: "nx-toast__action",
          cancelButton: "nx-toast__cancel",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
