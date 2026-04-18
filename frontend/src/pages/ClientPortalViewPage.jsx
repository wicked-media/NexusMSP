import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Loader2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
            <p className="text-lg font-medium">{error}</p>
            <p className="text-sm text-muted-foreground mt-2">If you have a portal account, you can log in directly.</p>
            <Button className="mt-4" onClick={() => navigate("/portal-login")}>Go to Portal Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Authenticating portal access...</p>
      </div>
    </div>
  );
}
