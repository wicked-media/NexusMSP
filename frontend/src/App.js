import { useEffect, useState, createContext, useContext, Suspense } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
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

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
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
  emerald: { primary: "142 76% 36%", ring: "142 76% 36%" },
  blue: { primary: "217 91% 60%", ring: "217 91% 60%" },
  cyan: { primary: "188 95% 43%", ring: "188 95% 43%" },
  violet: { primary: "258 90% 66%", ring: "258 90% 66%" },
  orange: { primary: "25 95% 53%", ring: "25 95% 53%" },
  red: { primary: "0 84% 60%", ring: "0 84% 60%" },
  sky: { primary: "199 89% 48%", ring: "199 89% 48%" },
  rose: { primary: "347 77% 50%", ring: "347 77% 50%" },
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

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
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
      document.documentElement.style.setProperty("--primary", a.primary);
      document.documentElement.style.setProperty("--ring", a.ring);
    }
    localStorage.setItem("nexusops_accent", accent);
  }, [accent]);

  useEffect(() => {
    const f = FONTS[font];
    if (f) document.documentElement.style.setProperty("--font-sans", f);
    localStorage.setItem("nexusops_font", font);
  }, [font]);

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
    <ThemeContext.Provider value={{ theme, toggleTheme, preset, setPreset, accent, setAccent, font, setFont, THEME_PRESETS, ACCENT_COLORS, FONTS }}>
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

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        try {
          const response = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setUser(response.data);
        } catch (error) {
          secureStorage.removeItem("nexusops_token");
          setToken(null);
        }
      }
      setLoading(false);
    };
    initAuth();
  }, [token]);

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API}/auth/login`, { email, password });
      const { token: newToken, user: userData } = response.data;
      secureStorage.setItem("nexusops_token", newToken);
      setToken(newToken);
      setUser(userData);
      toast.success("Welcome back!");
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Login failed");
      return false;
    }
  };

  const register = async (name, email, password) => {
    try {
      const response = await axios.post(`${API}/auth/register`, { name, email, password });
      const { token: newToken, user: userData } = response.data;
      secureStorage.setItem("nexusops_token", newToken);
      setToken(newToken);
      setUser(userData);
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
      return true;
    } catch {
      secureStorage.removeItem("nexusops_token");
      setToken(null);
      throw new Error("Invalid token");
    }
  };

  const logout = () => {
    secureStorage.removeItem("nexusops_token");
    setToken(null);
    setUser(null);
    toast.success("Logged out successfully");
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithToken, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCopilotToggle={() => setCopilotOpen(o => !o)} />
      <main className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? 'ml-[72px]' : 'ml-[260px]'} ${copilotOpen ? 'mr-[380px]' : ''}`}>
        <div className="p-6 md:p-8">
          {children}
        </div>
      </main>
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
      <Component />
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
      <Toaster position="top-right" richColors />
    </AuthProvider>
    </ThemeProvider>
  );
}

function GlobalAddons() {
  const { token } = useAuth();
  if (!token) return null;
  return <AuthedAddons />;
}

function AuthedAddons() {
  usePresenceHeartbeat();
  return (
    <>
      <ChatPanel />
      <KonamiCRT />
      <ShortcutPalette />
    </>
  );
}

export default App;
