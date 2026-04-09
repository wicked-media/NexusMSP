import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/App";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    const processCallback = async () => {
      const token = searchParams.get("token");
      const provider = searchParams.get("provider");
      const error = searchParams.get("sso_error");

      if (error) {
        setStatus("error");
        toast.error(`SSO Error: ${error.replace(/_/g, " ")}`);
        setTimeout(() => navigate("/login", { replace: true }), 2000);
        return;
      }

      if (!token) {
        setStatus("error");
        toast.error("No authentication token received");
        setTimeout(() => navigate("/login", { replace: true }), 2000);
        return;
      }

      try {
        await loginWithToken(token);
        setStatus("success");
        toast.success(`Signed in with ${provider || "SSO"}`);
        setTimeout(() => navigate("/", { replace: true }), 500);
      } catch {
        setStatus("error");
        toast.error("Failed to authenticate");
        setTimeout(() => navigate("/login", { replace: true }), 2000);
      }
    };

    processCallback();
  }, [searchParams, navigate, loginWithToken]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center" data-testid="auth-callback-page">
      <div className="text-center space-y-4">
        {status === "processing" && (
          <>
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto" />
            <p className="text-zinc-400 text-sm">Completing sign-in...</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-zinc-300 text-sm">Authenticated! Redirecting...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-10 h-10 text-red-500 mx-auto" />
            <p className="text-zinc-400 text-sm">Authentication failed. Redirecting to login...</p>
          </>
        )}
      </div>
    </div>
  );
}
