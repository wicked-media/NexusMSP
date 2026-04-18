import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Lock, Mail, Shield } from "lucide-react";

export default function PortalLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [code2FA, setCode2FA] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [branding, setBranding] = useState({});

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

  const companyName = branding.company_name || "NexusOps";
  const primaryColor = branding.primary_color || "#10b981";

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4" data-testid="portal-login-page">
      <Card className="w-full max-w-md border-border/40">
        <CardHeader className="text-center pb-2">
          {branding.company_logo_url && (
            <img src={branding.company_logo_url} alt="" className="h-10 mx-auto mb-3 object-contain" />
          )}
          <CardTitle className="text-xl">{companyName} Client Portal</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Sign in to access your IT dashboard</p>
        </CardHeader>
        <CardContent>
          {!show2FA ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="email" className="text-xs">Email</Label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" className="pl-9" required data-testid="portal-email" />
                </div>
              </div>
              <div>
                <Label htmlFor="password" className="text-xs">Password</Label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="pl-9" required data-testid="portal-password" />
                </div>
              </div>
              <Button type="submit" className="w-full" style={{ backgroundColor: primaryColor }} disabled={loading} data-testid="portal-login-btn">
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Sign In
              </Button>
            </form>
          ) : (
            <form onSubmit={handle2FA} className="space-y-4">
              <div className="text-center">
                <Shield className="w-10 h-10 mx-auto mb-2" style={{ color: primaryColor }} />
                <p className="text-sm text-muted-foreground">Enter the code from your authenticator app</p>
              </div>
              <Input type="text" value={code2FA} onChange={e => setCode2FA(e.target.value)} placeholder="000000" className="text-center text-2xl tracking-widest" maxLength={6} required data-testid="portal-2fa-code" />
              <Button type="submit" className="w-full" style={{ backgroundColor: primaryColor }} disabled={loading} data-testid="portal-2fa-btn">
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Verify
              </Button>
              <Button type="button" variant="ghost" className="w-full text-xs" onClick={() => setShow2FA(false)}>Back to login</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
