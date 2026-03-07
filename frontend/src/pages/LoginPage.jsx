import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Eye, EyeOff, Server, Shield, Headphones } from "lucide-react";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [registerData, setRegisterData] = useState({ name: "", email: "", password: "" });

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await login(loginData.email, loginData.password);
    setIsLoading(false);
    if (success) {
      navigate("/");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await register(registerData.name, registerData.email, registerData.password);
    setIsLoading(false);
    if (success) {
      navigate("/");
    }
  };

  const fillDemoCredentials = () => {
    setLoginData({ email: "admin@nexusops.io", password: "admin123" });
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      {/* Left Panel - Hero */}
      <div className="hidden lg:flex lg:w-[60%] login-bg relative">
        <div className="absolute inset-0 login-overlay" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold tracking-tight">NexusOps</span>
          </div>

          {/* Features */}
          <div className="space-y-8">
            <h1 className="text-4xl font-bold tracking-tight leading-tight">
              The Command Center<br />
              <span className="text-gradient">for Modern MSPs</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md">
              Unified RMM & PSA platform combining the best of Syncro and SuperOps. 
              Monitor, manage, and support your clients from a single dashboard.
            </p>
            
            <div className="grid grid-cols-3 gap-6 pt-4">
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-lg metric-icon-blue flex items-center justify-center">
                  <Server className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold">RMM</h3>
                <p className="text-sm text-muted-foreground">Real-time device monitoring</p>
              </div>
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-lg metric-icon-green flex items-center justify-center">
                  <Headphones className="w-6 h-6 text-green-500" />
                </div>
                <h3 className="font-semibold">Ticketing</h3>
                <p className="text-sm text-muted-foreground">SLA-powered help desk</p>
              </div>
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-lg metric-icon-yellow flex items-center justify-center">
                  <Shield className="w-6 h-6 text-yellow-500" />
                </div>
                <h3 className="font-semibold">Assets</h3>
                <p className="text-sm text-muted-foreground">Complete inventory tracking</p>
              </div>
            </div>
          </div>

          {/* Testimonial */}
          <div className="glass rounded-xl p-6 max-w-lg">
            <p className="text-sm leading-relaxed mb-4">
              "NexusOps transformed how we manage our 50+ clients. The unified dashboard 
              gives us complete visibility, and the SLA tracking keeps our response times sharp."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">JD</span>
              </div>
              <div>
                <p className="text-sm font-medium">James Davidson</p>
                <p className="text-xs text-muted-foreground">CTO, TechForce MSP</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Forms */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold tracking-tight">NexusOps</span>
          </div>

          <Card className="border-border/50 shadow-xl">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
              <CardDescription>Sign in to your account to continue</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login" data-testid="login-tab">Sign In</TabsTrigger>
                  <TabsTrigger value="register" data-testid="register-tab">Sign Up</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="admin@nexusops.io"
                        value={loginData.email}
                        onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                        required
                        data-testid="login-email-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <div className="relative">
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={loginData.password}
                          onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                          required
                          data-testid="login-password-input"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={isLoading}
                      data-testid="login-submit-button"
                    >
                      {isLoading ? "Signing in..." : "Sign In"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={fillDemoCredentials}
                      data-testid="demo-credentials-button"
                    >
                      Use Demo Credentials
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-name">Full Name</Label>
                      <Input
                        id="register-name"
                        type="text"
                        placeholder="John Doe"
                        value={registerData.name}
                        onChange={(e) => setRegisterData({ ...registerData, name: e.target.value })}
                        required
                        data-testid="register-name-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-email">Email</Label>
                      <Input
                        id="register-email"
                        type="email"
                        placeholder="john@company.com"
                        value={registerData.email}
                        onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                        required
                        data-testid="register-email-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-password">Password</Label>
                      <Input
                        id="register-password"
                        type="password"
                        placeholder="••••••••"
                        value={registerData.password}
                        onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                        required
                        minLength={6}
                        data-testid="register-password-input"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={isLoading}
                      data-testid="register-submit-button"
                    >
                      {isLoading ? "Creating account..." : "Create Account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
