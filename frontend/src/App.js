import { useCallback, useEffect, useState, createContext, useContext, Suspense } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import LoginPage from "@/pages/LoginPage";
import { Sidebar } from "@/components/Sidebar";
import { AICopilotPanel } from "@/components/AICopilotPanel";
import { routeConfig } from "@/config/routes";
import { secureStorage } from "@/lib/secureStorage";
import { ChatPanel } from "@/components/presence/ChatPanel";
import { usePresenceHeartbeat } from "@/components/presence/PresenceDot";
import KonamiCRT from "@/components/easter-eggs/KonamiCRT";
import ShortcutPalette from "@/components/easter-eggs/ShortcutPalette";
import CommandPalette from "@/components/CommandPalette";
import NexusQuickDock from "@/components/NexusQuickDock";
import NexusWorkspaceCompass from "@/components/NexusWorkspaceCompass";
import NexusObjectDock from "@/components/NexusObjectDock";
import NexusPrivacyCurtain from "@/components/NexusPrivacyCurtain";
import UniversalInspector from "@/components/UniversalInspector";
import { NavCountsProvider } from "@/hooks/useNavCounts";
import { ClientContextProvider } from "@/contexts/ClientContext";
import ClientContextBar from "@/components/ClientContextBar";
import { Menu } from "lucide-react";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (
  LOCAL_HOSTS.has(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : window.location.origin
);
export const API = `${BACKEND_URL}/api`;

// Theme Context
const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);

const THEME_PRESETS = {
  midnight: { label: "Midnight", bg: "#09090b", sidebar: "#0c0c10", accent: "emerald", font: "Inter" },
  oceanic: { label: "Oceanic", bg: "#0a1628", sidebar: "#0b1a30", accent: "cyan", font: "Inter" },
  carbon: { label: "Carbon", bg: "#111111", sidebar: "#161616", accent: "blue", font: "JetBrains Mono" },
  arctic: { label: "Arctic", bg: "#0f172a", sidebar: "#0e1525", accent: "sky", font: "Inter" },
  ember: { label: "Ember", bg: "#0d0807", sidebar: "#120c0a", accent: "orange", font: "Inter" },
  phantom: { label: "Phantom", bg: "#0a0a12", sidebar: "#0d0d18", accent: "violet", font: "Inter" },
};

const ACCENT_COLORS = {
  emerald: { primary: "142 72% 45%", lightPrimary: "142 72% 32%" },
  blue: { primary: "217 91% 60%", lightPrimary: "217 91% 48%" },
  cyan: { primary: "188 95% 43%", lightPrimary: "188 95% 32%" },
  violet: { primary: "258 90% 66%", lightPrimary: "258 72% 52%" },
  orange: { primary: "25 95% 53%", lightPrimary: "25 90% 42%" },
  red: { primary: "0 84% 60%", lightPrimary: "0 72% 48%" },
  sky: { primary: "199 89% 48%", lightPrimary: "199 89% 38%" },
  rose: { primary: "347 77% 50%", lightPrimary: "347 72% 42%" },
};

const FONTS = {
  "Inter": "'Inter', sans-serif",
  "JetBrains Mono": "'JetBrains Mono', monospace",
  "DM Sans": "'DM Sans', sans-serif",
  "Space Grotesk": "'Space Grotesk', sans-serif",
  "IBM Plex Sans": "'IBM Plex Sans', sans-serif",
  "Outfit": "'Outfit', sans-serif",
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => localStorage.getItem("nexusops_theme") || "dark");
  const [preset, setPreset] = useState(() => localStorage.getItem("nexusops_preset") || "midnight");
  const [accent, setAccent] = useState(() => localStorage.getItem("nexusops_accent") || "emerald");
  const [font, setFont] = useState(() => localStorage.getItem("nexusops_font") || "Inter");
  const [motion, setMotion] = useState(() => localStorage.getItem("nexusops_motion") || "system");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    localStorage.setItem("nexusops_theme", theme);
  }, [theme]);

  useEffect(() => {
    const p = THEME_PRESETS[preset];
    if (p && theme === "dark") {
      document.documentElement.style.setProperty("--theme-bg", p.bg);
      document.documentElement.style.setProperty("--theme-sidebar", p.sidebar);
    } else {
      document.documentElement.style.removeProperty("--theme-bg");
      document.documentElement.style.removeProperty("--theme-sidebar");
    }
    localStorage.setItem("nexusops_preset", preset);
  }, [preset, theme]);

  useEffect(() => {
    const a = ACCENT_COLORS[accent];
    if (a) {
      const primary = theme === "light" ? a.lightPrimary : a.primary;
      document.documentElement.style.setProperty("--primary", primary);
      document.documentElement.style.setProperty("--ring", primary);
    }
    localStorage.setItem("nexusops_accent", accent);
  }, [accent, theme]);

  useEffect(() => {
    const f = FONTS[font];
    if (f) document.documentElement.style.setProperty("--font-sans", f);
    localStorage.setItem("nexusops_font", font);
  }, [font]);

  useEffect(() => {
    const nextMotion = ["system", "full", "minimal", "none"].includes(motion) ? motion : "system";
    document.documentElement.dataset.motion = nextMotion;
    localStorage.setItem("nexusops_motion", nextMotion);
    window.dispatchEvent(new CustomEvent("nexus-motion-change", { detail: { motion: nextMotion } }));
  }, [motion]);

  // Load Google Fonts dynamically
  useEffect(() => {
    const families = ["DM+Sans", "Space+Grotesk", "IBM+Plex+Sans", "Outfit", "JetBrains+Mono"];
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}:wght@400;500;600;700`).join("&")}&display=swap`;
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, preset, setPreset, accent, setAccent, font, setFont, motion, setMotion, THEME_PRESETS, ACCENT_COLORS, FONTS }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(secureStorage.getItem("nexusops_token"));
  const [loading, setLoading] = useState(true);
  const [authServiceUnavailable, setAuthServiceUnavailable] = useState(false);

  const clearSession = useCallback(() => {
    secureStorage.removeItem("nexusops_token");
    setToken(null);
    setUser(null);
    setAuthServiceUnavailable(false);
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        // A token can expire while a technician is working. Clear it globally
        // so every protected page returns to sign-in instead of showing a
        // misleading module-specific loading error.
        if (error.response?.status === 401) {
          clearSession();
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [clearSession]);

  const hydrateSession = useCallback(async () => {
    if (!token) {
      setUser(null);
      setAuthServiceUnavailable(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);
      setAuthServiceUnavailable(false);
    } catch (error) {
      const status = error.response?.status;
      // A server restart, network interruption, or a 5xx response must not
      // silently sign a technician out. Only an explicitly invalid session
      // should remove the saved token.
      if (status === 401 || status === 403) {
        clearSession();
      } else {
        setAuthServiceUnavailable(true);
      }
    } finally {
      setLoading(false);
    }
  }, [clearSession, token]);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  const login = async (email, password, twoFactorCode = "") => {
    try {
      const response = await axios.post(`${API}/auth/login`, { email, password, two_factor_code: twoFactorCode });
      if (response.data.requires_2fa) return { requires2FA: true };
      const { token: newToken, user: userData } = response.data;
      secureStorage.setItem("nexusops_token", newToken);
      setToken(newToken);
      setUser(userData);
      setAuthServiceUnavailable(false);
      toast.success("Welcome back!");
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.detail || (error.request ? "Unable to reach the Nexus authentication service" : "Login failed");
      toast.error(message);
      return { success: false, error: message, status: error.response?.status || null };
    }
  };

  const register = async (name, email, password) => {
    try {
      const response = await axios.post(`${API}/auth/register`, { name, email, password });
      const { token: newToken, user: userData } = response.data;
      secureStorage.setItem("nexusops_token", newToken);
      setToken(newToken);
      setUser(userData);
      setAuthServiceUnavailable(false);
      toast.success("Account created successfully!");
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Registration failed");
      return false;
    }
  };

  const loginWithToken = async (newToken) => {
    secureStorage.setItem("nexusops_token", newToken);
    setToken(newToken);
    try {
      const response = await axios.get(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${newToken}` }
      });
      setUser(response.data);
      setAuthServiceUnavailable(false);
      return true;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        clearSession();
        throw new Error("Invalid token");
      }
      setAuthServiceUnavailable(true);
      throw new Error("Nexus authentication service is temporarily unavailable");
    }
  };

  const refreshUser = async () => {
    if (!token) return null;
    const response = await axios.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setUser(response.data);
    return response.data;
  };

  const logout = () => {
    clearSession();
    toast.success("Logged out successfully");
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithToken, register, logout, refreshUser, loading, authServiceUnavailable, retrySession: hydrateSession }}>
      {children}
    </AuthContext.Provider>
  );
};

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, token, loading, authServiceUnavailable, retrySession } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (token && !user && authServiceUnavailable) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Session preserved</p>
          <h1 className="mt-3 text-xl font-semibold text-foreground">Nexus is reconnecting</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your sign-in is still saved. The authentication service is temporarily unavailable, so we have not signed you out.
          </p>
          <button
            type="button"
            onClick={retrySession}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Retry connection
          </button>
        </section>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

// Main Layout with Sidebar
const MainLayout = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const openCopilot = () => setCopilotOpen(true);
    window.addEventListener("nexus:open-copilot", openCopilot);
    return () => window.removeEventListener("nexus:open-copilot", openCopilot);
  }, []);

  useEffect(() => {
    const toggleFocus = (event) => {
      setFocusMode((current) => {
        const next = typeof event.detail?.enabled === "boolean" ? event.detail.enabled : !current;
        if (next) setCopilotOpen(false);
        return next;
      });
    };
    window.addEventListener("nexus:focus-mode", toggleFocus);
    return () => window.removeEventListener("nexus:focus-mode", toggleFocus);
  }, []);

  useEffect(() => {
    setFocusMode(false);
    setMobileNavigationOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.dataset.focusMode = focusMode ? "true" : "false";
    const exitFocus = (event) => { if (event.key === "Escape") setFocusMode(false); };
    if (focusMode) window.addEventListener("keydown", exitFocus);
    else window.removeEventListener("keydown", exitFocus);
    return () => {
      window.removeEventListener("keydown", exitFocus);
      delete document.documentElement.dataset.focusMode;
    };
  }, [focusMode]);

  return (
    <div className="min-h-screen bg-background flex" style={{ backgroundColor: "var(--theme-bg, hsl(var(--background)))" }}>
      {!focusMode && mobileNavigationOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}
      {!focusMode && <Sidebar collapsed={sidebarCollapsed} mobileOpen={mobileNavigationOpen} onMobileClose={() => setMobileNavigationOpen(false)} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCopilotToggle={() => setCopilotOpen(o => !o)} />}
      {!focusMode && (
        <div className="fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-border/80 bg-background/90 px-3 backdrop-blur-xl md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => { setSidebarCollapsed(false); setMobileNavigationOpen(true); }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-card text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold tracking-tight">NexusMSP</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("nexus:open-command-palette"))}
            className="ml-auto rounded-lg border border-border/70 bg-card/70 px-3 py-2 text-xs text-muted-foreground"
          >
            Search
          </button>
        </div>
      )}
      <main className={`min-w-0 flex-1 transition-all duration-300 ${focusMode ? 'ml-0' : sidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-[260px]'} ${copilotOpen ? 'xl:mr-[456px]' : ''}`}>
        <div className={`${focusMode ? 'p-4 md:p-8' : 'px-4 pb-24 pt-20 md:p-8'}`}>
          {!focusMode && <ClientContextBar />}
          <div key={location.pathname} className={`nx-page-stage ${focusMode ? "nx-focus-stage" : ""}`}>
            {children}
          </div>
        </div>
      </main>
      {focusMode && <button type="button" onClick={() => setFocusMode(false)} className="fixed right-5 top-5 z-40 rounded-xl border border-primary/25 bg-card/90 px-3 py-2 text-xs font-semibold text-primary shadow-lg backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" data-testid="exit-focus-mode">Exit focus mode <span className="ml-1 text-muted-foreground">Esc</span></button>}
      <AICopilotPanel isOpen={copilotOpen} onClose={() => setCopilotOpen(false)} />
    </div>
  );
};

// Loading fallback for lazy-loaded components
const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

// Route element builder
const buildRouteElement = (route) => {
  const Component = route.component;
  let element = (
    <Suspense fallback={<PageLoader />}>
      <Component redirectTab={route.redirectTab} redirectTo={route.redirectTo} />
    </Suspense>
  );

  if (route.layout) {
    element = <MainLayout>{element}</MainLayout>;
  }

  if (route.auth) {
    element = <ProtectedRoute>{element}</ProtectedRoute>;
  }

  return element;
};

// App Component
function App() {
  useEffect(() => {
    const seedData = async () => {
      try {
        await axios.post(`${API}/seed`);
      } catch (error) {
        // Ignore if already seeded
      }
    };
    seedData();
  }, []);

  return (
    <ThemeProvider>
    <AuthProvider>
      <ClientContextGate>
      <NavCountsProvider>
      <BrowserRouter>
        <GlobalAddons />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {routeConfig.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={buildRouteElement(route)}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </NavCountsProvider>
      </ClientContextGate>
      <Toaster />
    </AuthProvider>
    </ThemeProvider>
  );
}

function GlobalAddons() {
  const { token } = useAuth();
  if (!token) return null;
  return <AuthedAddons token={token} />;
}

function ClientContextGate({ children }) {
  const { token } = useAuth();
  return <ClientContextProvider api={API} token={token}>{children}</ClientContextProvider>;
}

function AuthedAddons({ token }) {
  usePresenceHeartbeat();
  return (
    <>
      <ChatPanel />
      <KonamiCRT />
      <ShortcutPalette />
      <CommandPalette />
      <NexusQuickDock />
      <NexusWorkspaceCompass />
      <NexusObjectDock />
      <NexusPrivacyCurtain />
      <UniversalInspector token={token} />
    </>
  );
}

export default App;
