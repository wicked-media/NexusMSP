import { useCallback, useEffect, useState, createContext, useContext, Suspense } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import LoginPage from "@/pages/LoginPage";
import { NotificationBell, Sidebar } from "@/components/Sidebar";
import TechnicianAccountMenu from "@/components/TechnicianAccountMenu";
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
import WeatherStrip from "@/components/ambient/WeatherStrip";
import { Bot, Menu, Search } from "lucide-react";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
// Only the local dev server reaches a directly exposed API on :8000. A
// production build (including the containerised web tier behind nginx) must use
// same-origin /api/, which proxies to the API service without publishing it.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (
  process.env.NODE_ENV === "development" && LOCAL_HOSTS.has(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : window.location.origin
);
export const API = `${BACKEND_URL}/api`;
// A protected route must not remain on its global loading spinner forever when
// the local API is restarting or an intermediary leaves the socket open. The
// recovery state below preserves the session and gives the technician an
// explicit retry instead.
const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;

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
        headers: { Authorization: `Bearer ${token}` },
        timeout: AUTH_BOOTSTRAP_TIMEOUT_MS,
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

  // Newly invited technicians complete the versioned readiness flow before
  // entering operational workspaces. The server derives this flag from the
  // account-owned checklist, so a browser cannot bypass the requirement by
  // hiding or changing the UI.
  const isOnboardingLearningRoute = ["/technician-onboarding", "/nexus-academy"].includes(location.pathname)
    || (location.pathname === "/documentation-hub" && new URLSearchParams(location.search).get("tab") === "help");
  if (user.onboarding_required && !isOnboardingLearningRoute) {
    return <Navigate to="/nexus-academy" state={{ from: location }} replace />;
  }

  return children;
};

// Main Layout with Sidebar
const MainLayout = ({ children }) => {
  const { user, logout, token } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const collaborationWorkspace = location.pathname === "/team-chat";
  const deviceRecordWorkspace = /^\/devices\/[^/]+$/.test(location.pathname);
  const restoreSidebarCollapsed = useCallback((value) => {
    setSidebarCollapsed(Boolean(value));
  }, []);

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
  }, [location.pathname, location.search]);

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

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className={`${collaborationWorkspace ? "h-[100dvh] overflow-hidden" : "min-h-screen"} bg-background flex`} style={{ backgroundColor: "var(--theme-bg, hsl(var(--background)))" }}>
      {!focusMode && mobileNavigationOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-[35] bg-black/65 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}
      {!focusMode && <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavigationOpen}
        onMobileClose={() => setMobileNavigationOpen(false)}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        onCollapsedPreferenceRestore={restoreSidebarCollapsed}
      />}
      {!focusMode && (
        <header className={`fixed right-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-border/70 bg-background/90 px-3 shadow-[0_10px_30px_-26px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-[left] duration-300 ${sidebarCollapsed ? "left-0 md:left-[64px]" : "left-0 md:left-[240px]"}`} data-testid="global-technician-bar">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => { setSidebarCollapsed(false); setMobileNavigationOpen(true); }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-card text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold tracking-tight md:hidden">NexusMSP</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("nexus:open-command-palette"))}
            className="hidden h-9 min-w-[220px] items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 text-left text-xs text-muted-foreground transition hover:border-primary/25 hover:bg-card hover:text-foreground md:flex"
            data-testid="topbar-search"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search Nexus</span>
            <span className="ml-auto rounded border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono text-[9px]">Ctrl K</span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {location.pathname === "/" && <WeatherStrip compact />}
            <button
              type="button"
              onClick={() => setCopilotOpen((open) => !open)}
              className={`hidden h-9 items-center gap-2 rounded-lg px-2.5 text-xs transition sm:flex ${copilotOpen ? "bg-primary/[0.12] text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              aria-pressed={copilotOpen}
              data-testid="topbar-copilot-toggle"
            >
              <Bot className="h-4 w-4" />
              <span className="hidden xl:inline">Copilot</span>
            </button>
            <NotificationBell token={token} placement="topbar" />
            <TechnicianAccountMenu
              user={user}
              theme={theme}
              onSettings={() => navigate("/my-settings")}
              onThemeToggle={toggleTheme}
              onCopilot={() => setCopilotOpen(true)}
              onLogout={handleLogout}
            />
          </div>
        </header>
      )}
      <main className={`min-w-0 flex-1 transition-all duration-300 ${collaborationWorkspace ? "flex min-h-0 flex-col overflow-hidden" : ""} ${focusMode ? 'ml-0' : sidebarCollapsed ? 'md:ml-[64px]' : 'md:ml-[240px]'} ${copilotOpen ? 'xl:mr-[456px]' : ''}`}>
        <div className={collaborationWorkspace ? 'flex min-h-0 flex-1 flex-col px-3 pb-3 pt-[68px] md:px-4 md:pb-4 md:pt-[72px]' : focusMode ? 'p-4 md:p-8' : deviceRecordWorkspace ? 'px-4 pb-24 pt-20 md:px-7 md:pb-7 md:pt-[72px]' : 'px-4 pb-24 pt-20 md:px-8 md:pb-8 md:pt-[80px]'}>
          <div key={location.pathname} className={`nx-page-stage ${focusMode ? "nx-focus-stage" : ""} ${collaborationWorkspace ? "flex min-h-0 flex-1 flex-col" : ""}`}>
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
