import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { ArrowRight, Loader2, LockKeyhole, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ClientPortalViewPage() {
  const { token: portalToken } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const authenticate = async () => {
      try {
        const res = await axios.post(`${API}/portal/v2/token-auth`, { token: portalToken });
        if (res.data.authenticated) {
          sessionStorage.setItem("portal_token", res.data.token);
          sessionStorage.setItem("portal_user", JSON.stringify(res.data.user));
          navigate("/portal-dashboard", { replace: true });
        } else {
          // No portal user — redirect to login with context
          setError(`No portal account found for ${res.data.client_name || "this client"}. Please log in or contact your IT provider.`);
        }
      } catch (e) {
        setError(e.response?.data?.detail || "Portal link expired or invalid");
      }
    };
    authenticate();
  }, [portalToken, navigate]);

  if (error) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b10] p-5 text-slate-100" data-testid="portal-token-error">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(52,211,153,0.11),transparent_30%),radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.08),transparent_32%)]" />
        <div className="relative w-full max-w-[540px] overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101820]/95 shadow-[0_35px_100px_-45px_rgba(0,0,0,0.95)]">
          <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(244,63,94,0.11),transparent_42%)] p-7 text-center sm:p-9">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/20">
              <XCircle className="h-6 w-6" />
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-300">Secure link unavailable</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">We could not open this portal link</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">{error}</p>
          </div>
          <div className="p-7 sm:p-9">
            <div className="flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <p className="text-xs leading-5 text-slate-500">For your security, expired and revoked links cannot be reused. If you already have an account, sign in with your normal portal credentials.</p>
            </div>
            <Button className="mt-5 h-11 w-full rounded-xl bg-emerald-400 font-semibold text-emerald-950 hover:bg-emerald-300" onClick={() => navigate("/portal-login")}>
              Go to secure sign in <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b10] p-5 text-slate-100" data-testid="portal-token-loading">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(52,211,153,0.11),transparent_30%),radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.08),transparent_32%)]" />
      <div className="relative w-full max-w-[460px] rounded-3xl border border-white/[0.08] bg-[#101820]/95 p-9 text-center shadow-[0_35px_100px_-45px_rgba(0,0,0,0.95)]">
        <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
          <Loader2 className="h-6 w-6 animate-spin" />
          <LockKeyhole className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#101820] p-1 text-sky-300" />
        </div>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Secure client workspace</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Verifying your access</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Confirming the link, organisation, and client permissions before opening the portal.</p>
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-emerald-500 to-sky-300" />
        </div>
      </div>
    </div>
  );
}
