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

// Animated typing effect hook
function useTypingEffect(texts, speed = 80, pause = 2000) {
  const [display, setDisplay] = useState("");
  const [textIdx, setTextIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = texts[textIdx];
    let timeout;
    if (!deleting && charIdx < current.length) {
      timeout = setTimeout(() => setCharIdx(c => c + 1), speed);
    } else if (!deleting && charIdx === current.length) {
      timeout = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && charIdx > 0) {
      timeout = setTimeout(() => setCharIdx(c => c - 1), speed / 2);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setTextIdx(i => (i + 1) % texts.length);
    }
    setDisplay(current.slice(0, charIdx));
    return () => clearTimeout(timeout);
  }, [charIdx, deleting, textIdx, texts, speed, pause]);

  return display;
}

// Particle canvas for login ambiance
function ParticleField() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    const particles = [];
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);
    const handleMouse = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const handleLeave = () => { mouseRef.current = { x: -1000, y: -1000 }; };
    canvas.addEventListener("mousemove", handleMouse);
    canvas.addEventListener("mouseleave", handleLeave);
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        r: Math.random() * 2.5 + 1.2,
        o: Math.random() * 0.5 + 0.3,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      particles.forEach(p => {
        // Mouse magnetic attraction
        const dxm = mx - p.x;
        const dym = my - p.y;
        const distM = Math.sqrt(dxm * dxm + dym * dym);
        if (distM < 250 && distM > 1) {
          const force = (250 - distM) / 250 * 0.04;
          p.vx += (dxm / distM) * force;
          p.vy += (dym / distM) * force;
        }
        // Dampen velocity
        p.vx *= 0.985; p.vy *= 0.985;
        // Minimum drift so they always move
        if (Math.abs(p.vx) < 0.15) p.vx += (Math.random() - 0.5) * 0.3;
        if (Math.abs(p.vy) < 0.15) p.vy += (Math.random() - 0.5) * 0.3;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        // Glow near mouse
        const glowFactor = distM < 200 ? (1 - distM / 200) * 0.8 : 0;
        const radius = p.r + glowFactor * 4;
        // Outer glow
        if (glowFactor > 0.1) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(16, 185, 129, ${glowFactor * 0.15})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(52, 211, 153, ${Math.min(p.o + glowFactor, 1)})`;
        ctx.fill();
      });
      // Draw lines between close particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(52, 211, 153, ${0.2 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
        // Draw lines to mouse
        const dxm = mx - particles[i].x;
        const dym = my - particles[i].y;
        const distM = Math.sqrt(dxm * dxm + dym * dym);
        if (distM < 200) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mx, my);
          ctx.strokeStyle = `rgba(52, 211, 153, ${0.35 * (1 - distM / 200)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); canvas.removeEventListener("mousemove", handleMouse); canvas.removeEventListener("mouseleave", handleLeave); };
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

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
  const [wallpaper, setWallpaper] = useState(null);
  const [brand, setBrand] = useState({ company_name: "NexusOps", login_tagline: "", login_features: ["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"], powered_by_visible: true });

  const typedText = useTypingEffect([
    "Command Center",
    "NOC Dashboard",
    "Service Desk",
    "Asset Manager",
    "Security Hub",
  ], 90, 2200);

  useEffect(() => {
    const ssoError = searchParams.get("sso_error");
    if (ssoError) toast.error(`SSO Error: ${ssoError.replace(/_/g, " ")}`);
    axios.get(`${API}/settings/microsoft-sso/status`).then(r => setSsoEnabled(r.data?.enabled)).catch(() => {});
    axios.get(`${API}/settings/login-wallpaper`).then(r => {
      if (r.data?.url && r.data?.type !== "default") setWallpaper(r.data);
    }).catch(() => {});
    // Fetch branding
    axios.get(`${API}/settings/branding/public`).then(r => {
      if (r.data?.company_name) setBrand(r.data);
      if (r.data?.company_name && r.data.company_name !== "NexusOps") {
        document.title = r.data.company_name;
      }
    }).catch(() => {});
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

  const now = new Date();
  const hour = now.getHours();
  const timeGreeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const timeIcon = hour < 6 ? "🌙" : hour < 12 ? "☀️" : hour < 17 ? "🌤️" : hour < 21 ? "🌆" : "🌙";

  return (
    <div className="min-h-screen flex relative overflow-hidden" data-testid="login-page">
      {/* Background Layer */}
      <div className="absolute inset-0">
        {wallpaper?.url ? (
          <>
            <img src={wallpaper.url} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: "brightness(0.4)" }} />
            <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${wallpaper.overlay_opacity || 0.7})` }} />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#0a0a0f]">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(circle at 25% 25%, rgba(16, 185, 129, 0.06) 0%, transparent 50%),
                               radial-gradient(circle at 75% 75%, rgba(59, 130, 246, 0.06) 0%, transparent 50%),
                               radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.03) 0%, transparent 50%)`,
            }} />
          </div>
        )}
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
        {/* Particle network */}
        <ParticleField />
      </div>

      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-[55%] relative z-10">
        <div className="flex flex-col justify-between p-16 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div className="absolute -inset-1 bg-emerald-500/20 rounded-lg blur-sm -z-10" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">{brand.company_name}</span>
          </div>

          {/* Hero with animated typing */}
          <div className="space-y-8 max-w-lg">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-xs font-medium backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Platform Active
              </div>

              {/* Animated time greeting */}
              <div className="flex items-center gap-3 mb-2" data-testid="time-greeting">
                <span className="text-3xl" style={{ animation: "floatBounce 3s ease-in-out infinite" }}>{timeIcon}</span>
                <span className="text-lg text-zinc-400 font-medium">{timeGreeting}</span>
              </div>

              <h1 className="text-5xl font-bold tracking-tight leading-[1.1] text-white">
                Your IT<br />
                <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  {typedText}
                </span>
                <span className="inline-block w-0.5 h-10 bg-emerald-400 ml-1 align-middle" style={{ animation: "blink 1s step-end infinite" }} />
              </h1>

              <p className="text-base text-zinc-400 leading-relaxed max-w-md">
                {brand.login_tagline || "Unified RMM & PSA platform for modern managed service providers. Monitor, manage, and support from a single pane of glass."}
              </p>
            </div>

            {/* Stats with entrance animation */}
            <div className="grid grid-cols-3 gap-6">
              {[
                { value: "99.9%", label: "Uptime SLA", color: "emerald" },
                { value: "< 2s", label: "Avg Response", color: "cyan" },
                { value: "256-bit", label: "AES Encryption", color: "blue" },
              ].map((stat, i) => (
                <div key={`k-${i}`} className="space-y-1" style={{ animation: `fadeSlideIn 0.6s ease-out ${0.3 + i * 0.15}s both` }}>
                  <p className={`text-2xl font-bold font-mono text-${stat.color}-400`}>{stat.value}</p>
                  <p className="text-xs text-zinc-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
              {(brand.login_features?.length > 0 ? brand.login_features : ["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"]).map((f, i) => (
                <span key={f} className="px-3 py-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-sm text-xs text-zinc-400 font-medium" style={{ animation: `fadeSlideIn 0.5s ease-out ${0.6 + i * 0.08}s both` }}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom */}
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
            <span className="text-xl font-bold tracking-tight text-white">{brand.company_name}</span>
          </div>

          <div className="p-8 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-xl shadow-2xl shadow-black/20" style={{ animation: "fadeSlideIn 0.7s ease-out 0.1s both" }}>
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

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes blink { 50% { opacity:0; } }
        @keyframes floatBounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }
      `}</style>
    </div>
  );
}
