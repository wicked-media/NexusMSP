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
import RentalsPage from "@/pages/RentalsPage";
import VendorsPage from "@/pages/VendorsPage";
import TicketSettingsPage from "@/pages/TicketSettingsPage";
import DmarcCompliancePage from "@/pages/DmarcCompliancePage";
import SplynxDashboardPage from "@/pages/SplynxDashboardPage";
import XeroDashboardPage from "@/pages/XeroDashboardPage";
import O365SetupPage from "@/pages/O365SetupPage";
import AssetLifecyclePage from "@/pages/AssetLifecyclePage";
import PredictiveMaintenancePage from "@/pages/PredictiveMaintenancePage";
import HealthRadarPage from "@/pages/HealthRadarPage";
import WhiteLabelPage from "@/pages/WhiteLabelPage";
import LoyaltyDashboardPage from "@/pages/LoyaltyDashboardPage";
import TicketPingSettingsPage from "@/pages/TicketPingSettingsPage";
import GradientPage from "@/pages/GradientPage";
import FinancialReportsPage from "@/pages/FinancialReportsPage";
import StocktakePage from "@/pages/StocktakePage";
import EstimatesPage from "@/pages/EstimatesPage";
import SmartSchedulePage from "@/pages/SmartSchedulePage";
import StatusBoardPage from "@/pages/StatusBoardPage";
import OnboardingWizardPage from "@/pages/OnboardingWizardPage";
import SentimentDashboardPage from "@/pages/SentimentDashboardPage";
import ClientHealthPage from "@/pages/ClientHealthPage";
import WallboardPage from "@/pages/WallboardPage";
import MagicPortalPage from "@/pages/MagicPortalPage";
import TopologyPage from "@/pages/TopologyPage";
import RunbooksPage from "@/pages/RunbooksPage";
import VaultPage from "@/pages/VaultPage";
import QrAssetsPage from "@/pages/QrAssetsPage";
import CampaignsPage from "@/pages/CampaignsPage";
import SlaTimerPage from "@/pages/SlaTimerPage";
import BenchmarkingPage from "@/pages/BenchmarkingPage";
import BillingReconPage from "@/pages/BillingReconPage";
import UpsellPage from "@/pages/UpsellPage";
import RoiReportsPage from "@/pages/RoiReportsPage";
import DocScannerPage from "@/pages/DocScannerPage";
import ClientTimelinePage from "@/pages/ClientTimelinePage";
import CompliancePage from "@/pages/CompliancePage";
import RpeDashboardPage from "@/pages/RpeDashboardPage";
import DispatchBoardPage from "@/pages/DispatchBoardPage";
import ContractProfitPage from "@/pages/ContractProfitPage";
import VendorScorecardPage from "@/pages/VendorScorecardPage";
import ItRoadmapPage from "@/pages/ItRoadmapPage";
import WarrantyTrackerPage from "@/pages/WarrantyTrackerPage";
import ClientComparePage from "@/pages/ClientComparePage";
import SkillsMatrixPage from "@/pages/SkillsMatrixPage";
import ApprovalWorkflowsPage from "@/pages/ApprovalWorkflowsPage";
import AssetDepreciationPage from "@/pages/AssetDepreciationPage";
import PostmortemPage from "@/pages/PostmortemPage";
import CsatSurveysPage from "@/pages/CsatSurveysPage";

// Components
import { Sidebar } from "@/components/Sidebar";
import { AICopilotPanel } from "@/components/AICopilotPanel";

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
            path="/stocktake"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <StocktakePage />
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
          <Route
            path="/rentals"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <RentalsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendors"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <VendorsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/ticket-settings"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TicketSettingsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dmarc-compliance"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DmarcCompliancePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/splynx-dashboard"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SplynxDashboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/xero"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <XeroDashboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/o365-setup"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <O365SetupPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/asset-lifecycle"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <AssetLifecyclePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/predictive-maintenance"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <PredictiveMaintenancePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/health-radar"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <HealthRadarPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/white-label"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <WhiteLabelPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/loyalty"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <LoyaltyDashboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/ticket-ping-settings"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TicketPingSettingsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/gradient"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <GradientPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/financial-reports"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <FinancialReportsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/estimates"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <EstimatesPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/smart-scheduling"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SmartSchedulePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <OnboardingWizardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sentiment"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SentimentDashboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-health"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ClientHealthPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallboard"
            element={
              <ProtectedRoute>
                <WallboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/topology"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TopologyPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/runbooks"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <RunbooksPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vault"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <VaultPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/qr-assets"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <QrAssetsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/campaigns"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <CampaignsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sla-timer"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SlaTimerPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/benchmarking"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <BenchmarkingPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing-recon"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <BillingReconPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/upsell"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <UpsellPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/roi-reports"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <RoiReportsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/doc-scanner"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DocScannerPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-timeline"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ClientTimelinePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/compliance"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <CompliancePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/rpe-dashboard"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <RpeDashboardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dispatch-board"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DispatchBoardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/contract-profit"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ContractProfitPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor-scorecard"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <VendorScorecardPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/it-roadmap"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ItRoadmapPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranty-tracker"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <WarrantyTrackerPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-compare"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ClientComparePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/skills-matrix"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SkillsMatrixPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/approvals"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ApprovalWorkflowsPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/asset-depreciation"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <AssetDepreciationPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/postmortem"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <PostmortemPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/csat-surveys"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <CsatSurveysPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/portal/:token"
            element={<MagicPortalPage />}
          />
          <Route
            path="/status-board/:clientId"
            element={<StatusBoardPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
