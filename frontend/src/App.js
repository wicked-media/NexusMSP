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

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Theme Context
const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => localStorage.getItem("nexusops_theme") || "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("nexusops_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
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

export default App;
