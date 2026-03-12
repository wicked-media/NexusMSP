import { useEffect, useState, createContext, useContext } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// Pages
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import TicketsPage from "@/pages/TicketsPage";
import DevicesPage from "@/pages/DevicesPage";
import AssetsPage from "@/pages/AssetsPage";
import ClientsPage from "@/pages/ClientsPage";
import ContractsPage from "@/pages/ContractsPage";
import InvoicesPage from "@/pages/InvoicesPage";
import TimeTrackingPage from "@/pages/TimeTrackingPage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import Pax8Page from "@/pages/Pax8Page";
import DomotzPage from "@/pages/DomotzPage";
import RemoteAccessPage from "@/pages/RemoteAccessPage";
import DeviceChatPage from "@/pages/DeviceChatPage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";
import LeadsPage from "@/pages/LeadsPage";
import AcronisPage from "@/pages/AcronisPage";
import EmailPage from "@/pages/EmailPage";
import ScriptingPage from "@/pages/ScriptingPage";
import ITDocumentationPage from "@/pages/ITDocumentationPage";
import ProjectsPage from "@/pages/ProjectsPage";
import ProxmoxPage from "@/pages/ProxmoxPage";
import ExpiryTrackerPage from "@/pages/ExpiryTrackerPage";
import TechniciansPage from "@/pages/TechniciansPage";
import SchedulingPage from "@/pages/SchedulingPage";
import ProductsPage from "@/pages/ProductsPage";
import PurchaseOrdersPage from "@/pages/PurchaseOrdersPage";
import DeviceDetailPage from "@/pages/DeviceDetailPage";
import NetworkingPage from "@/pages/NetworkingPage";
import LeaderboardPage from "@/pages/LeaderboardPage";

// Components
import { Sidebar } from "@/components/Sidebar";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("nexusops_token"));
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
          localStorage.removeItem("nexusops_token");
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
      localStorage.setItem("nexusops_token", newToken);
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
      localStorage.setItem("nexusops_token", newToken);
      setToken(newToken);
      setUser(userData);
      toast.success("Account created successfully!");
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Registration failed");
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("nexusops_token");
    setToken(null);
    setUser(null);
    toast.success("Logged out successfully");
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
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

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <main className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? 'ml-[72px]' : 'ml-[260px]'}`}>
        <div className="p-6 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

// App Component
function App() {
  // Seed data on initial load
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
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DashboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TicketsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/devices"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DevicesPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/devices/:deviceId"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DeviceDetailPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <AssetsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ClientsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/contracts"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ContractsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <InvoicesPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/time-tracking"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TimeTrackingPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/knowledge-base"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <KnowledgeBasePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pax8"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Pax8Page />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/domotz"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DomotzPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/remote-access"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <RemoteAccessPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/devices/:deviceId/chat"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DeviceChatPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ReportsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SettingsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <LeadsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/acronis"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <AcronisPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/email"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <EmailPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/scripting"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ScriptingPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/documentation"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ITDocumentationPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ProjectsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/proxmox"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ProxmoxPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/expiry-tracker"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ExpiryTrackerPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ProductsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <PurchaseOrdersPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/networking"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <NetworkingPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/technicians"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TechniciansPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/scheduling"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SchedulingPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <LeaderboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
