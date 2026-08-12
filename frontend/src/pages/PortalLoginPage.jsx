import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Activity, ArrowLeft, ArrowRight, CheckCircle2, FileText, LifeBuoy,
  Loader2, Lock, Mail, Monitor, ReceiptText, Shield, Sparkles,
} from "lucide-react";

export default function PortalLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [code2FA, setCode2FA] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [branding, setBranding] = useState({});
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    axios.get(`${API}/settings/branding/public`).then(r => setBranding(r.data)).catch(() => {});
    // Check if already logged in
    const t = sessionStorage.getItem("portal_token");
    if (t) navigate("/portal-dashboard", { replace: true });
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`${API}/portal/v2/login`, { email, password });
      if (res.data.requires_2fa) {
        setTempToken(res.data.temp_token);
        setShow2FA(true);
        toast.info("Enter your 2FA code");
      } else {
        sessionStorage.setItem("portal_token", res.data.token);
        sessionStorage.setItem("portal_user", JSON.stringify(res.data.user));
        toast.success("Welcome back!");
        navigate("/portal-dashboard", { replace: true });
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally { setLoading(false); }
  };

  const handle2FA = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`${API}/portal/v2/verify-2fa`, { temp_token: tempToken, code: code2FA });
      sessionStorage.setItem("portal_token", res.data.token);
      sessionStorage.setItem("portal_user", JSON.stringify(res.data.user));
      toast.success("Welcome back!");
      navigate("/portal-dashboard", { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Invalid code");
    } finally { setLoading(false); }
  };

  const companyName = branding.company_name || "NexusMSP";
  const primaryColor = branding.primary_color || "#10b981";

  return (
    <div className="portal-login-experience relative min-h-screen overflow-hidden bg-[#070b10] text-slate-100" data-testid="portal-login-page" style={{ "--portal-primary": primaryColor }}>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="portal-login-atmosphere absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(52,211,153,0.16),transparent_28%),radial-gradient(circle_at_85%_80%,rgba(56,189,248,0.11),transparent_30%)]" />
        <div className="portal-login-grid absolute inset-0 opacity-[0.18]" />
        <div className="portal-login-planet portal-login-planet-one" />
        <div className="portal-login-planet portal-login-planet-two" />
        <div className="portal-login-scan absolute inset-x-0 top-[22%] h-px" />
      </div>
      <div className="relative mx-auto grid min-h-screen max-w-[1500px] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="portal-login-story hidden flex-col justify-between border-r border-white/[0.07] p-10 lg:flex xl:p-14">
          <div className="portal-login-brand flex items-center gap-3">
            {branding.company_logo_url && !logoFailed ? (
              <img src={branding.company_logo_url} alt={companyName} onError={() => setLogoFailed(true)} className="h-11 w-11 rounded-2xl object-contain" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-sm font-black text-emerald-950">NX</div>
            )}
            <div>
              <p className="text-sm font-semibold text-white">{companyName}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Secure client workspace</p>
            </div>
          </div>

          <div className="portal-login-hero max-w-2xl py-12">
            <div className="portal-login-eyebrow inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />Everything in one place
            </div>
            <h1 className="portal-login-title mt-6 text-5xl font-semibold tracking-[-0.045em] text-white xl:text-6xl">
              Your technology,
              <span className="block bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">clearly managed.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
              Support, managed assets, services, billing, protection, and shared documents—connected through one secure, auditable client experience.
            </p>
            <div className="mt-9 grid max-w-2xl gap-3 sm:grid-cols-2">
              {[
                { icon: LifeBuoy, label: "Track every request", detail: "One shared service conversation" },
                { icon: Monitor, label: "See managed assets", detail: "Live status and secure support" },
                { icon: ReceiptText, label: "Understand billing", detail: "Professional invoices and payments" },
                { icon: FileText, label: "Access shared records", detail: "Only documents approved for you" },
              ].map(({ icon: Icon, label, detail }) => (
                <div key={label} className="portal-login-capability flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/[0.08] text-emerald-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div><p className="text-xs font-semibold text-slate-200">{label}</p><p className="mt-1 text-[10px] text-slate-600">{detail}</p></div>
                </div>
              ))}
            </div>
          </div>

          <div className="portal-login-assurance flex items-center justify-between border-t border-white/[0.07] pt-5">
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-40" /><span className="relative h-2 w-2 rounded-full bg-emerald-300" /></span>
              Portal services operational
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-600"><Shield className="h-3.5 w-3.5" />Tenant-scoped access</div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center p-5 sm:p-8 lg:p-12">
          <div className="w-full max-w-[470px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              {branding.company_logo_url && !logoFailed ? <img src={branding.company_logo_url} alt={companyName} onError={() => setLogoFailed(true)} className="h-10 w-10 rounded-xl object-contain" /> : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400 text-xs font-black text-emerald-950">NX</div>}
              <div><p className="text-sm font-semibold text-white">{companyName}</p><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300">Client workspace</p></div>
            </div>

            <div className="portal-login-card overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101820]/95 shadow-[0_35px_100px_-45px_rgba(0,0,0,0.95)] backdrop-blur-xl">
              <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_42%)] p-6 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
                  {show2FA ? <Shield className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white">{show2FA ? "Verify your sign-in" : "Welcome back"}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {show2FA ? "Enter the current six-digit code from your authenticator app." : `Sign in to your secure ${companyName} client workspace.`}
                </p>
              </div>

              <div className="p-6 sm:p-8">
                {!show2FA ? (
                  <form onSubmit={handleLogin} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-xs text-slate-400">Email address</Label>
                      <div className="portal-login-field relative">
                        <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                        <Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-12 rounded-xl border-white/[0.08] bg-black/15 pl-10" required data-testid="portal-email" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-xs text-slate-400">Password</Label>
                      <div className="portal-login-field relative">
                        <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" className="h-12 rounded-xl border-white/[0.08] bg-black/15 pl-10" required data-testid="portal-password" />
                      </div>
                    </div>
                    <Button type="submit" className="portal-login-submit h-12 w-full rounded-xl bg-emerald-400 font-semibold text-emerald-950 hover:bg-emerald-300" disabled={loading} data-testid="portal-login-btn">
                      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}Sign in securely
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={handle2FA} className="space-y-5">
                    <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4">
                      <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><p className="text-xs leading-5 text-slate-400">Your password was accepted. Multi-factor verification is required to finish this secure sign-in.</p></div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-400">Authenticator code</Label>
                      <Input type="text" inputMode="numeric" autoComplete="one-time-code" value={code2FA} onChange={e => setCode2FA(e.target.value.replace(/\D/g, ""))} placeholder="000000" className="h-14 rounded-xl border-white/[0.08] bg-black/15 text-center text-2xl tracking-[0.35em]" maxLength={6} required data-testid="portal-2fa-code" />
                    </div>
                    <Button type="submit" className="portal-login-submit h-12 w-full rounded-xl bg-emerald-400 font-semibold text-emerald-950 hover:bg-emerald-300" disabled={loading} data-testid="portal-2fa-btn">
                      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}Verify and continue
                    </Button>
                    <Button type="button" variant="ghost" className="w-full text-xs text-slate-500 hover:bg-white/[0.03] hover:text-white" onClick={() => setShow2FA(false)}><ArrowLeft className="mr-2 h-3.5 w-3.5" />Back to sign in</Button>
                  </form>
                )}

                <div className="mt-6 flex items-center justify-between border-t border-white/[0.07] pt-5">
                  <div className="flex items-center gap-2 text-[10px] text-slate-600"><Activity className="h-3.5 w-3.5 text-emerald-300" />Secure service connection</div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-600"><Shield className="h-3.5 w-3.5" />Audited access</div>
                </div>
              </div>
            </div>
            <p className="mt-6 text-center text-[10px] leading-5 text-slate-700">Authorised contacts only. Access is logged and restricted to your organisation.</p>
          </div>
        </section>
      </div>
      <style>{`
        @keyframes portalLoginAtmosphere { 0%,100% { transform:scale(1.02) translate3d(0,0,0); } 50% { transform:scale(1.08) translate3d(-1.2%,-.8%,0); } }
        @keyframes portalLoginDrift { 0%,100% { transform:translate3d(0,0,0) scale(1); opacity:.22; } 50% { transform:translate3d(-30px,18px,0) scale(1.12); opacity:.36; } }
        @keyframes portalLoginReveal { from { opacity:0; transform:translate3d(0,14px,0); } to { opacity:1; transform:translate3d(0,0,0); } }
        @keyframes portalLoginTitle { from { opacity:0; transform:translate3d(-14px,15px,0); clip-path:inset(0 0 100% 0); } to { opacity:1; transform:translate3d(0,0,0); clip-path:inset(0 0 0 0); } }
        @keyframes portalLoginShimmer { 0%,100% { background-position:0% 50%; } 50% { background-position:100% 50%; } }
        @keyframes portalLoginScan { 0%,100% { transform:scaleX(.5); opacity:.04; } 50% { transform:scaleX(1); opacity:.58; } }
        @keyframes portalLoginPulse { 0%,100% { box-shadow:0 0 0 rgba(34,211,238,0); } 50% { box-shadow:0 16px 42px -27px rgba(34,211,238,.75); } }
        .portal-login-atmosphere { animation:portalLoginAtmosphere 20s ease-in-out infinite; }
        .portal-login-grid { background-image:linear-gradient(rgba(148,163,184,.11) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.11) 1px,transparent 1px); background-size:64px 64px; mask-image:linear-gradient(to bottom,black,transparent 72%); }
        .portal-login-planet { position:absolute; border-radius:9999px; filter:blur(80px); animation:portalLoginDrift 18s ease-in-out infinite; }
        .portal-login-planet-one { top:18%; left:12%; height:20rem; width:20rem; background:rgba(16,185,129,.3); }
        .portal-login-planet-two { right:6%; bottom:2%; height:18rem; width:18rem; background:rgba(56,189,248,.25); animation-delay:-9s; }
        .portal-login-scan { background:linear-gradient(90deg,transparent,rgba(52,211,153,.12),rgba(34,211,238,.8),rgba(52,211,153,.12),transparent); animation:portalLoginScan 7.5s ease-in-out infinite; }
        .portal-login-brand, .portal-login-eyebrow, .portal-login-hero > p, .portal-login-assurance { opacity:0; animation:portalLoginReveal .55s ease-out forwards; }
        .portal-login-brand { animation-delay:.08s; }
        .portal-login-eyebrow { animation-delay:.2s; }
        .portal-login-title { opacity:0; animation:portalLoginTitle .8s cubic-bezier(.2,.72,.2,1) .32s forwards; }
        .portal-login-title span { background-size:220% 220%; animation:portalLoginShimmer 7s ease-in-out 1.15s infinite; }
        .portal-login-hero > p { animation-delay:.62s; }
        .portal-login-capability { opacity:0; animation:portalLoginReveal .45s ease-out forwards; transition:transform .22s ease,border-color .22s ease,background-color .22s ease; }
        .portal-login-capability:nth-child(1) { animation-delay:.78s; } .portal-login-capability:nth-child(2) { animation-delay:.88s; } .portal-login-capability:nth-child(3) { animation-delay:.98s; } .portal-login-capability:nth-child(4) { animation-delay:1.08s; }
        .portal-login-capability:hover { transform:translateY(-2px); border-color:rgba(52,211,153,.26); background-color:rgba(52,211,153,.045); }
        .portal-login-assurance { animation-delay:1.15s; }
        .portal-login-card { animation:portalLoginReveal .7s cubic-bezier(.2,.75,.2,1) .16s both, portalLoginPulse 7s ease-in-out 1.4s infinite; }
        .portal-login-field { transition:transform .2s ease; }
        .portal-login-field:focus-within { transform:translateY(-1px); }
        .portal-login-field:focus-within svg { color:rgb(110 231 183); filter:drop-shadow(0 0 7px rgba(52,211,153,.35)); }
        .portal-login-submit { background-image:linear-gradient(100deg,#34d399,#2dd4bf,#38bdf8,#34d399) !important; background-size:220% 220%; animation:portalLoginShimmer 6.5s ease-in-out infinite; box-shadow:0 15px 35px -18px rgba(45,212,191,.65); transition:transform .2s ease,box-shadow .2s ease !important; }
        .portal-login-submit:hover { transform:translateY(-1px); box-shadow:0 19px 42px -17px rgba(56,189,248,.8); }
        @media (prefers-reduced-motion: reduce) { .portal-login-experience *, .portal-login-experience *::before, .portal-login-experience *::after { animation:none !important; transition:none !important; transform:none !important; opacity:1 !important; clip-path:none !important; } }
      `}</style>
    </div>
  );
}
