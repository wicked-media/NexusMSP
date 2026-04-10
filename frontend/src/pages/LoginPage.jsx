import { useState, useEffect, useRef } from "react";
import { useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { useAuth, API } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [registerData, setRegisterData] = useState({ name: "", email: "", password: "" });
  const canvasRef = useRef(null);

  useEffect(() => {
    // Check for SSO errors in URL
    const ssoError = searchParams.get("sso_error");
    if (ssoError) toast.error(`SSO Error: ${ssoError.replace(/_/g, " ")}`);
    // Check if Microsoft SSO is enabled
    axios.get(`${API}/settings/microsoft-sso/status`).then(r => setSsoEnabled(r.data?.enabled)).catch(() => {});
  }, [searchParams]);

  if (user) return <Navigate to="/" replace />;

  const handleMicrosoftLogin = () => {
    setSsoLoading(true);
    window.location.href = `${API}/auth/microsoft/login`;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await login(loginData.email, loginData.password);
    setIsLoading(false);
    if (success) navigate("/");
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await register(registerData.name, registerData.email, registerData.password);
    setIsLoading(false);
    if (success) navigate("/");
  };

  const fillDemoCredentials = () => {
    setLoginData({ email: "aaron@stech.com.au", password: "" });
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden" data-testid="login-page">
      {/* Animated Background */}
      <div className="absolute inset-0 bg-[#0a0a0f]">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 25% 25%, rgba(16, 185, 129, 0.06) 0%, transparent 50%),
                           radial-gradient(circle at 75% 75%, rgba(59, 130, 246, 0.06) 0%, transparent 50%),
                           radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.03) 0%, transparent 50%)`,
        }} />
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
        {/* Floating orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-[120px] animate-pulse" style={{animationDuration: '8s'}} />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] animate-pulse" style={{animationDuration: '12s', animationDelay: '2s'}} />
      </div>

      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-[55%] relative z-10">
        <div className="flex flex-col justify-between p-16 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div className="absolute -inset-1 bg-emerald-500/20 rounded-lg blur-sm -z-10" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">NexusOps</span>
          </div>

          {/* Hero */}
          <div className="space-y-8 max-w-lg">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Platform Active
              </div>
              <h1 className="text-5xl font-bold tracking-tight leading-[1.1] text-white">
                Infrastructure<br />
                <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  Command Center
                </span>
              </h1>
              <p className="text-base text-zinc-400 leading-relaxed max-w-md">
                Unified RMM & PSA platform for modern managed service providers. Monitor, manage, and support from a single pane of glass.
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6">
              {[
                { value: "99.9%", label: "Uptime SLA", color: "emerald" },
                { value: "< 2s", label: "Avg Response", color: "cyan" },
                { value: "256-bit", label: "AES Encryption", color: "blue" },
              ].map((stat, i) => (
                <div key={`k-${i}`} className="space-y-1">
                  <p className={`text-2xl font-bold font-mono text-${stat.color}-400`}>{stat.value}</p>
                  <p className="text-xs text-zinc-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
              {["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"].map(f => (
                <span key={f} className="px-3 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400 font-medium">
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom quote */}
          <div className="flex items-center gap-4 border-t border-zinc-800/50 pt-6">
            <div className="flex -space-x-2">
              {["AT", "SC", "MR"].map((init, i) => (
                <div key={`k-${i}`} className="w-8 h-8 rounded-full border-2 border-[#0a0a0f] bg-zinc-800 flex items-center justify-center text-[10px] font-medium text-zinc-400">
                  {init}
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              Trusted by <span className="text-zinc-300 font-medium">200+</span> managed service providers
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-[380px]">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-white">NexusOps</span>
          </div>

          <div className="p-8 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-xl shadow-2xl shadow-black/20">
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8 bg-zinc-800/50">
                <TabsTrigger value="login" data-testid="login-tab" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400">Sign In</TabsTrigger>
                <TabsTrigger value="register" data-testid="register-tab" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Email</Label>
                    <Input
                      type="email" placeholder="admin@nexusops.io"
                      value={loginData.email}
                      onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                      required data-testid="login-email-input"
                      className="h-11 bg-zinc-800/50 border-zinc-700/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Password</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"} placeholder="Enter password"
                        value={loginData.password}
                        onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                        required data-testid="login-password-input"
                        className="h-11 bg-zinc-800/50 border-zinc-700/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600 pr-10"
                      />
                      <Button type="button" variant="ghost" size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent text-zinc-500 hover:text-zinc-300"
                        onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-11 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-medium shadow-lg shadow-emerald-500/10 transition-all" disabled={isLoading} data-testid="login-submit-button">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Sign In <ArrowRight className="w-4 h-4 ml-1" /></>}
                  </Button>

                  {ssoEnabled && (
                    <>
                      <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800" /></div>
                        <div className="relative flex justify-center text-xs"><span className="bg-zinc-900/30 px-3 text-zinc-500">or</span></div>
                      </div>
                      <Button
                        type="button" variant="outline"
                        className="w-full h-11 border-zinc-700/50 bg-zinc-800/30 hover:bg-zinc-700/50 text-zinc-300 hover:text-white font-medium transition-all"
                        onClick={handleMicrosoftLogin}
                        disabled={ssoLoading}
                        data-testid="microsoft-sso-button"
                      >
                        {ssoLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" fill="none">
                            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                          </svg>
                        )}
                        Sign in with Microsoft
                      </Button>
                    </>
                  )}

                  <Button type="button" variant="ghost" className="w-full h-9 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50" onClick={fillDemoCredentials} data-testid="demo-credentials-button">
                    Use Demo Credentials
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Full Name</Label>
                    <Input type="text" placeholder="John Doe"
                      value={registerData.name}
                      onChange={(e) => setRegisterData({ ...registerData, name: e.target.value })}
                      required data-testid="register-name-input"
                      className="h-11 bg-zinc-800/50 border-zinc-700/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Email</Label>
                    <Input type="email" placeholder="john@company.com"
                      value={registerData.email}
                      onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                      required data-testid="register-email-input"
                      className="h-11 bg-zinc-800/50 border-zinc-700/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Password</Label>
                    <Input type="password" placeholder="Min 6 characters"
                      value={registerData.password}
                      onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                      required minLength={6} data-testid="register-password-input"
                      className="h-11 bg-zinc-800/50 border-zinc-700/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600" />
                  </div>
                  <Button type="submit" className="w-full h-11 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-medium shadow-lg shadow-emerald-500/10 transition-all" disabled={isLoading} data-testid="register-submit-button">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create Account <ArrowRight className="w-4 h-4 ml-1" /></>}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>

          <p className="text-center text-[11px] text-zinc-600 mt-6">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
