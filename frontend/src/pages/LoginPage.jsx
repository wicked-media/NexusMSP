import { useState, useEffect, useRef } from "react";
import { useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { useAuth, API } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, ArrowRight, Loader2, ShieldCheck, Moon, Sun, CloudSun, Sunset, ClipboardCheck, Lock, LockKeyhole, Activity, Radio, Network, Monitor, Database, MessageSquare, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";

const EXPERIENCE_IDS = ["classic", "constellation", "theatre", "calm"];
const TYPED_TEXTS = ["Command Center", "NOC Dashboard", "Service Desk", "Asset Manager", "Security Hub"];
const NEXUS_LOGIN_HERO_ART = "/brand/nexus-login-beacon.png";
const EXPERIENCE_CONTENT = {
  classic: {
    eyebrow: "Platform Active",
    title: "Your IT",
    accent: null,
    supporting: "Purpose-built for secure, accountable managed service operations.",
  },
  constellation: {
    eyebrow: "Nexus is ready",
    title: "Everything connected.",
    accent: "One secure entry.",
    supporting: "Your systems are protected, monitored and connected across one operational environment.",
  },
  theatre: {
    eyebrow: "Live operations",
    title: "Your operations.",
    accent: "Live from the first click.",
    supporting: "Start the day with every service, signal and accountable action connected.",
  },
  calm: {
    eyebrow: "Platform Active",
    title: "Nexus has your day",
    accent: "in view.",
    supporting: "A calm, secure entry into the work that matters most.",
  },
};

function BrandMark({ brand, compact = false }) {
  const iconUrl = brand.company_icon_url || "/brand/nexus-mark.png";
  const isNexusBrand = !brand.company_logo_url && (brand.company_name || "NexusMSP").replace(/\s/g, "").toLowerCase() === "nexusmsp";

  if (brand.company_logo_url) {
    return (
      <div className="flex items-center">
        <img src={brand.company_logo_url} alt={`${brand.company_name || "Company"} logo`} className={`${compact ? "h-9" : "h-11"} max-w-[210px] object-contain drop-shadow-[0_10px_24px_rgba(34,211,238,.12)]`} />
      </div>
    );
  }

  return (
    <div className={`brand-lockup group flex items-center ${compact ? "gap-2.5" : "gap-3.5"}`} aria-label={brand.company_name || "NexusMSP"}>
      <span className={`brand-mark-shell relative flex ${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 items-center justify-center rounded-[14px] border border-cyan-300/20 bg-[#071218]/80 p-1 shadow-[0_14px_36px_-16px_rgba(34,211,238,.75)] backdrop-blur-xl`}>
        <span className="brand-mark-orbit absolute -inset-1.5 rounded-[18px] border border-emerald-300/20" aria-hidden="true" />
        <span className="brand-mark-halo absolute -inset-2 -z-10 rounded-[20px] bg-gradient-to-br from-emerald-400/25 via-cyan-400/10 to-blue-500/20 blur-lg" aria-hidden="true" />
        <img src={iconUrl} alt="" className="relative z-10 h-full w-full object-contain transition-transform duration-500 group-hover:scale-105" />
      </span>

      {isNexusBrand ? (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 leading-none">
            <span className={`${compact ? "text-lg" : "text-[22px]"} font-semibold tracking-[-0.045em] text-white`}>Nexus</span>
            <span className="rounded-md border border-emerald-300/25 bg-emerald-400/[0.09] px-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300 shadow-[inset_0_0_14px_rgba(52,211,153,.05)]">MSP</span>
          </span>
          {!compact && <span className="mt-1.5 text-[8px] font-semibold uppercase tracking-[0.28em] text-cyan-100/45">Operations Platform</span>}
        </span>
      ) : (
        <span className={`${compact ? "text-lg" : "text-xl"} font-semibold tracking-[-0.025em] text-white`}>{brand.company_name}</span>
      )}
    </div>
  );
}

function NexusBrandBeacon({ visible }) {
  if (!visible) return null;

  return (
    <div className="nexus-brand-beacon" aria-hidden="true">
      <img src={NEXUS_LOGIN_HERO_ART} alt="Nexus MSP" className="nexus-brand-beacon-image" />
    </div>
  );
}

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
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;
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
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const loginRootRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [wallpaper, setWallpaper] = useState(null);
  const [brand, setBrand] = useState({ company_name: "NexusMSP", login_tagline: "", login_features: ["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"], login_experience: "classic", powered_by_visible: true });
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const previewMode = searchParams.get("preview") === "1";
  const requestedExperience = searchParams.get("experience");
  const savedExperience = EXPERIENCE_IDS.includes(brand.login_experience) ? brand.login_experience : "classic";
  const experience = previewMode && EXPERIENCE_IDS.includes(requestedExperience) ? requestedExperience : savedExperience;
  const experienceContent = EXPERIENCE_CONTENT[experience];
  const isNexusBrand = !brand.company_logo_url && (brand.company_name || "NexusMSP").replace(/\s/g, "").toLowerCase() === "nexusmsp";

  const typedText = useTypingEffect(TYPED_TEXTS, 90, 2200);

  useEffect(() => {
    const root = loginRootRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!root || reducedMotion.matches) return undefined;

    let frame = null;
    const applyDepth = (clientX, clientY) => {
      const rect = root.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width - 0.5) * 2));
      const y = Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height - 0.5) * 2));
      root.style.setProperty("--nx-bg-x", `${x * 10}px`);
      root.style.setProperty("--nx-bg-y", `${y * 7}px`);
      root.style.setProperty("--nx-story-x", `${x * 3}px`);
      root.style.setProperty("--nx-story-y", `${y * 2}px`);
      root.style.setProperty("--nx-auth-x", `${x * -4}px`);
      root.style.setProperty("--nx-auth-y", `${y * -3}px`);
    };
    const onPointerMove = event => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyDepth(event.clientX, event.clientY));
    };
    const onPointerLeave = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        ["--nx-bg-x", "--nx-bg-y", "--nx-story-x", "--nx-story-y", "--nx-auth-x", "--nx-auth-y"].forEach(name => root.style.setProperty(name, "0px"));
      });
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  useEffect(() => {
    // Apply the product identity immediately so a slow or unavailable branding
    // endpoint never exposes a stale browser title or favicon.
    document.title = "NexusMSP";
    let defaultFavicon = document.querySelector("link[rel='icon']");
    if (!defaultFavicon) {
      defaultFavicon = document.createElement("link");
      defaultFavicon.rel = "icon";
      document.head.appendChild(defaultFavicon);
    }
    defaultFavicon.href = "/brand/nexus-mark.png";

    const ssoError = searchParams.get("sso_error");
    if (ssoError) toast.error(`SSO Error: ${ssoError.replace(/_/g, " ")}`);
    axios.get(`${API}/settings/microsoft-sso/status`).then(r => setSsoEnabled(r.data?.enabled)).catch(() => {});
    axios.get(`${API}/settings/login-wallpaper`).then(r => {
      if (r.data?.url && r.data?.type !== "default") setWallpaper(r.data);
    }).catch(() => {});
    // Fetch branding
    axios.get(`${API}/settings/branding/public`).then(r => {
      if (r.data?.company_name) setBrand(r.data);
      document.title = r.data?.company_name || "NexusMSP";
      const iconHref = r.data?.favicon_url || r.data?.company_icon_url || "/brand/nexus-mark.png";
      let favicon = document.querySelector("link[rel='icon']");
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }
      favicon.href = iconHref;
    }).catch(() => {
      // The NexusMSP defaults above remain usable while the API reconnects.
    });
  }, [searchParams]);

  if (user && !previewMode) return <Navigate to="/" replace />;

  const handleMicrosoftLogin = () => {
    setSsoLoading(true);
    window.location.href = `${API}/auth/microsoft/login`;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsLoading(true);
    const result = await login(loginData.email, loginData.password, twoFactorCode);
    setIsLoading(false);
    if (result.requires2FA) {
      setTwoFactorRequired(true);
      toast.message("Enter the code from your authenticator app to continue.");
    }
    if (result.success) navigate("/");
    else if (!result.requires2FA) setAuthError(result.error || "Sign-in could not be completed. Check your details and try again.");
  };

  const fillDemoCredentials = () => {
    setLoginData({ email: "aaron@stech.com.au", password: "" });
  };

  const now = new Date();
  const hour = now.getHours();
  const timeGreeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const GreetingIcon = hour < 6 ? Moon : hour < 12 ? Sun : hour < 17 ? CloudSun : hour < 21 ? Sunset : Moon;

  return (
    <div ref={loginRootRef} className={`login-experience nexus-signin login-experience-${experience} relative flex min-h-[100svh] overflow-x-hidden bg-[#020611] lg:h-[100svh] lg:min-h-[680px] lg:overflow-hidden`} data-testid="login-page" data-login-experience={experience}>
      {/* Background Layer */}
      <div className="absolute inset-0">
        {wallpaper?.url && experience === "classic" ? (
          <>
            <img src={wallpaper.url} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: "brightness(0.4)" }} />
            <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${wallpaper.overlay_opacity || 0.7})` }} />
          </>
        ) : experience !== "classic" ? (
          <>
            <img
              src={`/login-experiences/${experience}.png`}
              alt=""
              className={`experience-background absolute inset-0 h-full w-full object-cover ${experience === "theatre" ? "theatre-world-motion" : ""}`}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,12,0.08)_0%,rgba(3,7,12,0.12)_52%,rgba(3,7,12,0.7)_100%)]" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#020611]">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(circle at 22% 22%, rgba(0, 184, 255, 0.16) 0%, transparent 34%),
                               radial-gradient(circle at 74% 76%, rgba(27, 100, 255, 0.11) 0%, transparent 38%),
                               radial-gradient(circle at 48% 48%, rgba(114, 88, 255, 0.06) 0%, transparent 52%)`,
            }} />
          </div>
        )}
        {/* Grid overlay */}
        <div className={`absolute inset-0 ${experience === "classic" ? "opacity-[0.02]" : "opacity-[0.012]"}`} style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
        {/* Particle network remains the interactive layer for classic and calm. */}
        {(experience === "classic" || experience === "calm") && <ParticleField />}
      </div>

      {previewMode && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/65 p-1 shadow-2xl backdrop-blur-xl" data-testid="login-preview-switcher">
          {EXPERIENCE_IDS.map(id => (
            <button key={id} type="button" onClick={() => navigate(`/login?preview=1&experience=${id}`)} className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${experience === id ? "bg-emerald-400 text-zinc-950" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`} aria-pressed={experience === id}>{id === "theatre" ? "Operations Theatre" : id}</button>
          ))}
        </div>
      )}

      {/* Left Panel */}
      <div className={`login-story-panel hidden lg:flex relative z-10 ${experience === "classic" ? "lg:w-[56%]" : experience === "calm" ? "lg:w-[65%]" : "lg:w-[64%]"}`}>
        <div className="flex w-full flex-col justify-between p-10 xl:p-14 2xl:p-16">
          {/* Logo */}
          <BrandMark brand={brand} />

          {/* Hero with animated typing */}
          <div className={`space-y-6 2xl:space-y-8 ${experience === "classic" ? "max-w-lg" : "max-w-xl"}`}>
            {isNexusBrand && (
              <div className="nexus-operations-showcase">
                <NexusBrandBeacon visible />
                <div className="nexus-operations-signals" aria-label="Nexus platform signals">
                  <span><Activity className="h-3.5 w-3.5" />Signals connected</span>
                  <span><ShieldCheck className="h-3.5 w-3.5" />Security ready</span>
                  <span><Network className="h-3.5 w-3.5" />One control plane</span>
                </div>
              </div>
            )}
            <div className="space-y-4">
              <div className="login-eyebrow inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-300/20 bg-cyan-400/[0.06] text-cyan-200 text-xs font-medium backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
                {experienceContent.eyebrow}
              </div>

              {/* Animated time greeting */}
              <div className="login-greeting flex items-center gap-3 mb-2" data-testid="time-greeting">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/[0.07]" style={{ animation: "floatBounce 3s ease-in-out infinite" }}><GreetingIcon className="h-5 w-5 text-cyan-200" /></span>
                <span className="text-lg text-zinc-400 font-medium">{timeGreeting}</span>
              </div>

              {experience === "classic" ? (
                <h1 className="text-5xl font-bold tracking-tight leading-[1.1] text-white" aria-label="Your IT operations command centre">
                  {isNexusBrand ? "The MSP platform" : "Your IT"}<br />
                  <span aria-hidden="true" className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-blue-500 bg-clip-text text-transparent">{isNexusBrand ? "that runs the MSP." : typedText}</span>
                  {!isNexusBrand && <span aria-hidden="true" className="inline-block w-0.5 h-10 bg-cyan-300 ml-1 align-middle" style={{ animation: "blink 1s step-end infinite" }} />}
                </h1>
              ) : (
                <h1 className={`login-hero-title ${experience === "calm" ? "text-6xl xl:text-7xl" : "text-5xl xl:text-6xl"} max-w-2xl font-semibold tracking-[-0.045em] leading-[0.98] text-white`}>
                  {experienceContent.title}<br />
                  <span className="login-hero-accent bg-gradient-to-r from-emerald-300 via-cyan-300 to-blue-400 bg-clip-text text-transparent">{experienceContent.accent}</span>
                </h1>
              )}

              <p className="login-summary text-base text-zinc-400 leading-relaxed max-w-md">
                {brand.login_tagline || "Unified RMM & PSA platform for modern managed service providers. Monitor, manage, and support from a single pane of glass."}
              </p>
              {experience !== "classic" && <p className="login-supporting max-w-md border-l border-emerald-400/70 pl-4 text-sm leading-6 text-zinc-300">{experienceContent.supporting}</p>}
            </div>

            {/* Trust controls — product capabilities rather than unsupported claims */}
            <div className="grid grid-cols-3 gap-6">
              {[
                { value: "RBAC", label: "Role-based access", icon: ShieldCheck, tone: "text-emerald-400" },
                { value: "Audit", label: "Accountable actions", icon: ClipboardCheck, tone: "text-cyan-400" },
                { value: "MFA", label: "Protected sign-in", icon: LockKeyhole, tone: "text-blue-400" },
              ].map((stat, i) => {
                const StatIcon = stat.icon;
                return (
                  <div key={`k-${i}`} className="login-trust-stat space-y-1" style={{ "--trust-delay": `${1.05 + i * 0.16}s` }}>
                    <p className={`flex items-center gap-2 text-xl font-bold font-mono ${stat.tone}`}><StatIcon className="h-4 w-4" />{stat.value}</p>
                    <p className="text-xs text-zinc-500">{stat.label}</p>
                  </div>
                );
              })}
            </div>

            {experience === "constellation" && (
              <div className="grid grid-cols-4 gap-2" aria-label="Connected operational services">
                {[[Monitor, "Devices"], [MessageSquare, "Tickets"], [Database, "Backups"], [ShieldCheck, "Security"]].map(([Icon, label], index) => (
                  <div key={label} className="constellation-service flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-zinc-300 backdrop-blur" style={{ animationDelay: `${0.45 + index * 0.12}s` }}><Icon className="h-4 w-4 text-emerald-300" /><span>{label}</span></div>
                ))}
              </div>
            )}

            {experience === "calm" && (
              <div className="grid max-w-lg gap-2 sm:grid-cols-3" aria-label="Workspace assurances">
                {[[LockKeyhole, "Protected sign-in"], [ClipboardCheck, "Actions audited"], [Network, "Services connected"]].map(([Icon, label], index) => (
                  <div key={label} className="calm-assurance flex items-center gap-2 text-xs text-zinc-400" style={{ animationDelay: `${0.5 + index * 0.16}s` }}><span className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-400/[0.06]"><Icon className="h-3.5 w-3.5 text-emerald-300" /></span>{label}</div>
                ))}
              </div>
            )}

            {/* Feature pills */}
            <div className={`flex flex-wrap gap-2 ${experience === "theatre" ? "lg:hidden" : ""}`}>
              {(brand.login_features?.length > 0 ? brand.login_features : ["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"]).map((f, i) => (
                <span key={f} className="px-3 py-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-sm text-xs text-zinc-400 font-medium" style={{ animation: `fadeSlideIn 0.5s ease-out ${0.6 + i * 0.08}s both` }}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom */}
          <div className="flex items-center gap-3 border-t border-zinc-800/50 pt-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/[0.07]"><ShieldCheck className="h-4 w-4 text-emerald-300" /></div>
            <p className="text-xs text-zinc-500">{experienceContent.supporting}</p>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth */}
      <div className={`login-auth-stage relative z-10 flex flex-1 items-center justify-center p-6 xl:p-8 ${experience === "theatre" ? "lg:pb-24" : ""}`}>
        <div className={`w-full ${experience === "classic" ? "max-w-[380px]" : "max-w-[420px]"}`}>
          {/* Mobile Logo */}
          <div className="lg:hidden mb-10 flex justify-center"><BrandMark brand={brand} compact /></div>

          <div className={`login-auth-panel overflow-hidden rounded-2xl border border-emerald-400/15 bg-zinc-950/70 backdrop-blur-xl shadow-2xl shadow-black/30 ${isLoading ? "is-authenticating" : ""} ${experience === "calm" ? "rounded-l-none border-l-emerald-300/50" : ""}`} style={{ animation: "fadeSlideIn 0.7s ease-out 0.1s both" }}>
          <div className={`login-auth-header border-b border-emerald-400/10 bg-gradient-to-br from-emerald-400/[0.08] via-transparent to-cyan-400/[0.04] px-8 ${isNexusBrand ? "py-4" : "py-6"}`}>
              <p className="login-auth-signal text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Secure workspace access</p>
              <h2 className="login-auth-title mt-1 text-2xl font-semibold text-white">Welcome back</h2>
              <p className="login-auth-copy mt-2 text-sm leading-relaxed text-zinc-400">Sign in with your technician account. New team members are invited by a NexusMSP administrator.</p>
            </div>
            <div className={isNexusBrand ? "p-6" : "p-8"}>
              <form onSubmit={handleLogin} className={`login-form ${isNexusBrand ? "space-y-4" : "space-y-5"}`} aria-busy={isLoading}>
                  {authError && (
                    <div className="login-auth-error flex items-start gap-2.5 rounded-lg border border-rose-400/25 bg-rose-500/[0.08] px-3 py-2.5 text-xs leading-relaxed text-rose-200" role="alert" data-testid="login-inline-error">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                      <div><p className="font-semibold">Sign-in unsuccessful</p><p className="mt-0.5 text-rose-200/75">{authError}</p></div>
                    </div>
                  )}
                  <div className="login-form-step space-y-2" style={{ "--form-delay": ".48s" }}>
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Email</Label>
                    <div className="login-field-shell group relative h-11">
                      <Mail className="login-field-icon pointer-events-none absolute inset-y-0 left-3 z-10 my-auto h-4 w-4 text-zinc-600 transition duration-300 group-focus-within:text-emerald-300" />
                      <Input
                        type="email" placeholder="you@company.com"
                        value={loginData.email}
                        onChange={(e) => { setLoginData({ ...loginData, email: e.target.value }); if (authError) setAuthError(""); }}
                        required data-testid="login-email-input"
                        className="h-11 bg-zinc-800/50 border-zinc-700/50 pl-10 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600"
                      />
                    </div>
                  </div>
                  <div className="login-form-step space-y-2" style={{ "--form-delay": ".58s" }}>
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Password</Label>
                    <div className="login-field-shell group relative h-11">
                      <Lock className="login-field-icon pointer-events-none absolute inset-y-0 left-3 z-10 my-auto h-4 w-4 text-zinc-600 transition duration-300 group-focus-within:text-cyan-300" />
                      <Input
                        type={showPassword ? "text" : "password"} placeholder="Enter password"
                        value={loginData.password}
                        onChange={(e) => { setLoginData({ ...loginData, password: e.target.value }); if (authError) setAuthError(""); }}
                        onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                        onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                        onBlur={() => setCapsLockOn(false)}
                        required data-testid="login-password-input"
                        className="h-11 bg-zinc-800/50 border-zinc-700/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-white placeholder:text-zinc-600 pl-10 pr-10"
                      />
                      <button type="button"
                        className="absolute inset-y-0 right-0 z-10 flex w-10 items-center justify-center rounded-r-lg text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        data-testid="toggle-login-password">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {capsLockOn && <p className="login-caps-warning flex items-center gap-1.5 text-[10px] font-medium text-amber-300" role="status"><TriangleAlert className="h-3 w-3" />Caps Lock is on</p>}
                  </div>
                  {twoFactorRequired && (
                    <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                      <Label className="flex items-center gap-2 text-xs font-medium text-emerald-300 uppercase tracking-wider"><ShieldCheck className="h-3.5 w-3.5" />Authenticator code</Label>
                      <Input
                        inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                        value={twoFactorCode} onChange={(e) => { setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6)); if (authError) setAuthError(""); }}
                        required maxLength={6} data-testid="login-2fa-input"
                        className="h-11 bg-zinc-800/50 border-zinc-700/50 font-mono tracking-[0.35em] text-center text-white placeholder:tracking-normal placeholder:text-zinc-600"
                      />
                    </div>
                  )}
                  <Button type="submit" className="login-primary-action group w-full h-11 bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 text-white font-medium shadow-lg shadow-emerald-500/10 transition-all hover:shadow-[0_12px_34px_-14px_rgba(34,211,238,.75)]" disabled={isLoading} data-testid="login-submit-button">
                    {isLoading ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Verifying workspace</> : <>{twoFactorRequired ? "Verify & Sign In" : "Sign In"} <ArrowRight className="login-submit-arrow w-4 h-4 ml-1 transition-transform duration-300 group-hover:translate-x-1" /></>}
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

                  {isLocalPreview && (
                    <Button type="button" variant="ghost" className="w-full h-9 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50" onClick={fillDemoCredentials} data-testid="demo-credentials-button">
                      Use local account email
                    </Button>
                  )}
                  <div className="login-audit-assurance flex items-center justify-center gap-2 pt-1 text-[11px] text-zinc-500">
                    <ShieldCheck className="login-assurance-icon h-3.5 w-3.5 text-emerald-400" />
                    Sign-in attempts and security challenges are audited.
                  </div>
                </form>
            </div>
          </div>

          <p className="text-center text-[11px] text-zinc-600 mt-6">
            Authorised users only · access is governed by your organisation&apos;s security policy.
          </p>
        </div>
      </div>

      {experience === "theatre" && (
        <div className="theatre-ribbon absolute inset-x-0 bottom-0 z-20 hidden h-20 items-center border-t border-cyan-300/10 bg-[#04080d]/80 px-8 backdrop-blur-xl lg:flex" aria-label="Live platform assurances">
          <div className="ribbon-live-label mr-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300"><Radio className="h-4 w-4" />Live activity</div>
          <div className="grid flex-1 grid-cols-4 divide-x divide-white/10">
            {[[Activity, "Monitoring active", "Operational signals ready"], [ClipboardCheck, "Audit ledger ready", "Accountable actions recorded"], [LockKeyhole, "MFA available", "Protected sign-in enabled"], [Network, "Platform connected", "Services in one workspace"]].map(([Icon, title, detail], index) => (
              <div key={title} className="ribbon-item flex items-center gap-3 px-6" style={{ "--ribbon-enter": `${0.55 + index * 0.15}s`, "--ribbon-cycle": `${1.4 + index * 1.8}s` }}><span className="ribbon-live-dot h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.7)]" /><Icon className="ribbon-live-icon h-4 w-4 text-cyan-300" /><div><p className="text-xs font-medium text-zinc-200">{title}</p><p className="mt-0.5 text-[10px] text-zinc-500">{detail}</p></div></div>
            ))}
          </div>
        </div>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes blink { 50% { opacity:0; } }
        @keyframes floatBounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }
        @keyframes atmosphereDrift { 0% { transform:scale(1.03) translate3d(0,0,0); } 50% { transform:scale(1.07) translate3d(-0.7%, -0.4%, 0); } 100% { transform:scale(1.03) translate3d(0,0,0); } }
        @keyframes worldOrbit {
          0% { transform:scale(1.045) translate3d(calc(-1.1% + var(--nx-bg-x, 0px)), calc(.25% + var(--nx-bg-y, 0px)), 0); filter:saturate(1.02) contrast(1.01); }
          45% { transform:scale(1.075) translate3d(calc(.45% + var(--nx-bg-x, 0px)), calc(-.65% + var(--nx-bg-y, 0px)), 0); filter:saturate(1.08) contrast(1.03); }
          100% { transform:scale(1.055) translate3d(calc(1.35% + var(--nx-bg-x, 0px)), calc(.2% + var(--nx-bg-y, 0px)), 0); filter:saturate(1.04) contrast(1.02); }
        }
        @keyframes brandOrbit { from { transform:rotate(0deg); opacity:.45; } 50% { opacity:.9; } to { transform:rotate(360deg); opacity:.45; } }
        @keyframes brandHalo { 0%,100% { opacity:.45; transform:scale(.94); } 50% { opacity:.85; transform:scale(1.08); } }
        @keyframes messageReveal { from { opacity:0; transform:translate3d(0,14px,0); clip-path:inset(0 0 35% 0); } to { opacity:1; transform:translate3d(0,0,0); clip-path:inset(0 0 0 0); } }
        @keyframes headlineReveal { from { opacity:0; transform:translate3d(-12px,12px,0); clip-path:inset(0 0 100% 0); } to { opacity:1; transform:translate3d(0,0,0); clip-path:inset(0 0 0 0); } }
        @keyframes accentFlow { 0% { background-position:0% 50%; filter:drop-shadow(0 0 0 rgba(34,211,238,0)); } 50% { background-position:100% 50%; filter:drop-shadow(0 0 12px rgba(34,211,238,.18)); } 100% { background-position:0% 50%; filter:drop-shadow(0 0 0 rgba(34,211,238,0)); } }
        @keyframes supportingSignal { 0%,100% { border-left-color:rgba(52,211,153,.55); } 50% { border-left-color:rgba(34,211,238,1); box-shadow:-7px 0 18px -10px rgba(34,211,238,.8); } }
        @keyframes trustActivate { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes authStepIn { from { opacity:0; transform:translateY(9px); } to { opacity:1; transform:translateY(0); } }
        @keyframes authSignal { 0%,100% { color:rgb(110 231 183); text-shadow:0 0 0 rgba(52,211,153,0); } 50% { color:rgb(165 243 252); text-shadow:0 0 14px rgba(34,211,238,.28); } }
        @keyframes primaryFlow { 0% { background-position:0% 50%; } 50% { background-position:100% 50%; } 100% { background-position:0% 50%; } }
        @keyframes assuranceBreathe { 0%,100% { opacity:.72; transform:scale(1); } 50% { opacity:1; transform:scale(1.08); filter:drop-shadow(0 0 5px rgba(52,211,153,.38)); } }
        @keyframes fieldFocusGlow { 0%,100% { box-shadow:0 0 0 rgba(52,211,153,0); } 50% { box-shadow:0 12px 30px -22px rgba(34,211,238,.8); } }
        @keyframes warningIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes authErrorIn { from { opacity:0; transform:translateY(-7px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes authenticatingPanel { 0%,100% { border-color:rgba(52,211,153,.18); } 50% { border-color:rgba(34,211,238,.42); box-shadow:0 26px 90px rgba(0,0,0,.46), 0 0 32px rgba(34,211,238,.09); } }
        @keyframes ribbonScan { 0% { transform:translateX(-22%); opacity:0; } 12% { opacity:.9; } 88% { opacity:.9; } 100% { transform:translateX(122%); opacity:0; } }
        @keyframes ribbonFocus { 0%,72%,100% { background-color:transparent; } 82% { background-color:rgba(34,211,238,.045); } }
        @keyframes liveDot { 0%,100% { transform:scale(.82); opacity:.65; box-shadow:0 0 8px rgba(52,211,153,.35); } 50% { transform:scale(1.18); opacity:1; box-shadow:0 0 18px rgba(52,211,153,.85); } }
        @keyframes liveLabel { 0%,100% { opacity:.76; } 50% { opacity:1; text-shadow:0 0 13px rgba(52,211,153,.28); } }
        @keyframes signalRise { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes edgeBreathe { 0%,100% { box-shadow:0 26px 90px rgba(0,0,0,.42), 0 0 0 1px rgba(52,211,153,.04); } 50% { box-shadow:0 28px 100px rgba(0,0,0,.5), 0 0 36px rgba(34,211,238,.08); } }
        @keyframes nexusBeaconEnter { from { opacity:0; transform:translateY(12px) scale(.96); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes nexusBeaconFloat { 0%,100% { transform:translateY(0) scale(1); filter:brightness(.92) saturate(1.08); } 50% { transform:translateY(-5px) scale(1.012); filter:brightness(1.04) saturate(1.22) drop-shadow(0 0 20px rgba(29,207,255,.25)); } }
        .nexus-signin::before { content:""; position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at 30% 34%,rgba(6,94,168,.2),transparent 31%),radial-gradient(ellipse at 78% 60%,rgba(8,98,193,.09),transparent 28%),linear-gradient(180deg,rgba(2,7,18,.03),rgba(2,6,17,.84)); z-index:1; }
        .nexus-signin .login-story-panel { background:linear-gradient(90deg,rgba(2,6,17,.12),rgba(2,9,22,.24) 72%,rgba(2,6,17,.52)); }
        .nexus-operations-showcase { position:relative; max-width:31rem; }
        .nexus-brand-beacon { display:flex; height:clamp(11rem,23vh,15rem); align-items:center; justify-content:center; overflow:hidden; border-radius:1.15rem; background:#020611; border:1px solid rgba(75,198,255,.12); box-shadow:inset 0 0 0 1px rgba(83,199,255,.03),0 28px 65px -36px rgba(0,163,255,.56); opacity:0; animation:nexusBeaconEnter .7s cubic-bezier(.2,.78,.2,1) .08s forwards; }
        .nexus-brand-beacon-image { height:100%; width:100%; object-fit:cover; object-position:center; animation:nexusBeaconFloat 7s ease-in-out 1s infinite; }
        .nexus-operations-signals { position:relative; z-index:2; display:flex; flex-wrap:wrap; gap:.55rem; margin-top:-1.2rem; padding-left:1.15rem; }
        .nexus-operations-signals span { display:inline-flex; align-items:center; gap:.42rem; border:1px solid rgba(99,220,255,.16); border-radius:999px; background:rgba(3,14,31,.86); padding:.44rem .68rem; color:rgb(165,243,252); font-size:.65rem; font-weight:600; letter-spacing:.045em; box-shadow:0 9px 26px -16px rgba(0,174,255,.54); backdrop-filter:blur(12px); }
        .experience-background { animation:atmosphereDrift 24s ease-in-out infinite; will-change:transform; }
        .login-experience-theatre .theatre-world-motion {
          animation:worldOrbit 30s cubic-bezier(.45,.05,.55,.95) infinite alternate;
          transform-origin:42% 48%;
          will-change:transform, filter;
        }
        .login-story-panel { transform:translate3d(var(--nx-story-x, 0px), var(--nx-story-y, 0px), 0); transition:transform 160ms ease-out; will-change:transform; }
        .login-auth-stage { transform:translate3d(var(--nx-auth-x, 0px), var(--nx-auth-y, 0px), 0); transition:transform 180ms ease-out; will-change:transform; }
        .brand-mark-orbit { animation:brandOrbit 12s linear infinite; border-top-color:rgba(52,211,153,.7); border-right-color:rgba(34,211,238,.48); }
        .brand-mark-halo { animation:brandHalo 4.8s ease-in-out infinite; }
        .login-eyebrow { opacity:0; animation:messageReveal .48s ease-out .12s forwards; }
        .login-greeting { opacity:0; animation:messageReveal .52s ease-out .28s forwards; }
        .login-hero-title { opacity:0; animation:headlineReveal .78s cubic-bezier(.2,.72,.2,1) .42s forwards; }
        .login-hero-accent { background-size:220% 220%; animation:accentFlow 7s ease-in-out 1.25s infinite; }
        .login-summary { opacity:0; animation:messageReveal .56s ease-out .72s forwards; }
        .login-supporting { opacity:0; animation:messageReveal .56s ease-out .86s forwards, supportingSignal 4.2s ease-in-out 1.6s infinite; }
        .login-trust-stat { opacity:0; animation:trustActivate .5s ease-out var(--trust-delay) forwards; }
        .login-auth-signal { animation:authSignal 5s ease-in-out 1s infinite; }
        .login-auth-title, .login-auth-copy, .login-form-step, .login-primary-action, .login-audit-assurance { opacity:0; animation:authStepIn .5s ease-out forwards; }
        .login-auth-title { animation-delay:.22s; }
        .login-auth-copy { animation-delay:.32s; }
        .login-form-step { animation-delay:var(--form-delay); }
        .login-primary-action { animation-name:authStepIn, primaryFlow; animation-duration:.5s, 7s; animation-delay:.7s, 1.2s; animation-fill-mode:forwards, none; animation-iteration-count:1, infinite; background-size:220% 220%; }
        .login-audit-assurance { animation-delay:.86s; }
        .login-assurance-icon { animation:assuranceBreathe 3.6s ease-in-out 1.5s infinite; }
        .login-field-shell { border-radius:.5rem; transition:transform .2s ease; }
        .login-field-shell:focus-within { transform:translateY(-1px); animation:fieldFocusGlow 2.2s ease-in-out infinite; }
        .login-field-shell:focus-within .login-field-icon { filter:drop-shadow(0 0 7px currentColor); }
        .login-caps-warning { animation:warningIn .2s ease-out both; }
        .login-auth-error { animation:authErrorIn .28s cubic-bezier(.2,.75,.25,1) both; }
        .login-auth-panel.is-authenticating { animation:authenticatingPanel 1.8s ease-in-out infinite !important; }
        .login-experience-theatre .login-auth-panel,
        .login-experience-constellation .login-auth-panel { animation:fadeSlideIn .7s ease-out .1s both, edgeBreathe 7s ease-in-out 1s infinite !important; }
        .nexus-signin .login-auth-panel { border-color:rgba(80,208,255,.22); background:linear-gradient(145deg,rgba(7,17,35,.95),rgba(2,7,17,.93)); box-shadow:0 32px 95px rgba(0,0,0,.52),0 0 0 1px rgba(88,205,255,.05),0 0 56px rgba(0,126,255,.08); }
        .nexus-signin .login-auth-header { border-bottom-color:rgba(87,207,255,.14); background:linear-gradient(135deg,rgba(30,144,255,.12),rgba(4,25,58,.03) 54%,rgba(0,214,255,.08)); }
        .nexus-signin .login-auth-signal { color:rgb(165,243,252); }
        .nexus-signin .login-primary-action { background-image:linear-gradient(100deg,#0877c9,#00b8e6,#4a76ff,#0877c9); box-shadow:0 15px 38px -18px rgba(0,174,255,.68); }
        .nexus-signin .login-field-shell:focus-within { animation:fieldFocusGlow 2.2s ease-in-out infinite; }
        .constellation-service, .calm-assurance { opacity:0; animation:signalRise .55s ease-out forwards; }
        .theatre-ribbon::before { content:""; position:absolute; left:0; right:0; top:-1px; height:1px; background:linear-gradient(90deg,transparent,rgba(52,211,153,.18),rgba(34,211,238,.9),rgba(96,165,250,.18),transparent); animation:ribbonScan 9s ease-in-out infinite; }
        .ribbon-live-label { animation:liveLabel 4s ease-in-out infinite; }
        .ribbon-item { opacity:0; border-radius:10px; animation:signalRise .55s ease-out var(--ribbon-enter) forwards, ribbonFocus 8s ease-in-out var(--ribbon-cycle) infinite; }
        .ribbon-live-dot { animation:liveDot 2.8s ease-in-out var(--ribbon-cycle) infinite; }
        .ribbon-live-icon { transition:filter .3s ease, transform .3s ease; }
        .ribbon-item:hover .ribbon-live-icon { filter:drop-shadow(0 0 8px rgba(34,211,238,.7)); transform:translateY(-1px); }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior:auto !important; }
          .experience-background, .theatre-world-motion, .login-story-panel, .login-auth-stage, .brand-mark-orbit, .brand-mark-halo, .nexus-brand-beacon, .nexus-brand-beacon-image, .login-eyebrow, .login-greeting, .login-hero-title, .login-hero-accent, .login-summary, .login-supporting, .login-trust-stat, .login-auth-panel, .login-auth-panel.is-authenticating, .login-auth-signal, .login-auth-title, .login-auth-copy, .login-form-step, .login-primary-action, .login-audit-assurance, .login-assurance-icon, .login-field-shell, .login-caps-warning, .login-auth-error, .constellation-service, .calm-assurance, .theatre-ribbon::before, .ribbon-live-label, .ribbon-item, .ribbon-live-dot, [style*="floatBounce"], [style*="fadeSlideIn"] { animation:none !important; opacity:1; transform:none; filter:none; clip-path:none; }
        }
      `}</style>
    </div>
  );
}
