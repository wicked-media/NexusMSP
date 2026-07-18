import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth, useTheme } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import SignatureManager from "@/components/email/SignatureManager";
import {
  User, Lock, Mail, Shield, Bell, Clock, Palette, Globe, Award, Trophy,
  Star, Zap, Plus, Trash2, Eye, EyeOff,
  CheckCircle, XCircle, ArrowLeft, Loader2, ChevronRight, Settings, Moon,
  Upload, Image, RefreshCw, ShieldCheck
} from "lucide-react";

const BADGES = [
  { id: "first_ticket", label: "First Blood", description: "Resolved first ticket", icon: "ticket", color: "#3b82f6" },
  { id: "speed_demon", label: "Speed Demon", description: "Resolved 5 tickets in one day", icon: "zap", color: "#f59e0b" },
  { id: "client_whisperer", label: "Client Whisperer", description: "5-star CSAT rating", icon: "star", color: "#a855f7" },
  { id: "night_owl", label: "Night Owl", description: "Resolved ticket after hours", icon: "moon", color: "#6366f1" },
  { id: "mentor", label: "Mentor", description: "Helped 10 team members", icon: "users", color: "#10b981" },
  { id: "sla_champion", label: "SLA Champion", description: "100% SLA compliance for 30 days", icon: "shield", color: "#ef4444" },
  { id: "automation_guru", label: "Automation Guru", description: "Created 5 automation rules", icon: "cog", color: "#f97316" },
  { id: "knowledge_base", label: "Knowledge Base", description: "Wrote 10 KB articles", icon: "book", color: "#14b8a6" },
];

const SETTINGS_SECTIONS = [
  { key: "profile", icon: User, label: "Profile", description: "Identity, contact details and skills" },
  { key: "security", icon: Lock, label: "Security", description: "Password, two-factor authentication and keys" },
  { key: "signature", icon: Mail, label: "Email signature", description: "Compose a professional default signature" },
  { key: "notifications", icon: Bell, label: "Notifications", description: "Choose which updates reach you" },
  { key: "schedule", icon: Clock, label: "Availability", description: "Working hours, on-call and auto-assignment" },
  { key: "display", icon: Palette, label: "Appearance", description: "Theme, density and local workspace preferences" },
  { key: "badges", icon: Trophy, label: "Achievements", description: "Progress, badges and recent contribution" },
];

export default function TechSettingsPage() {
  const { user, token } = useAuth();
  const { theme, toggleTheme, preset, setPreset, accent, setAccent, font, setFont, THEME_PRESETS, ACCENT_COLORS, FONTS } = useTheme();
  const headers = { Authorization: `Bearer ${token}` };
  const [searchParams, setSearchParams] = useSearchParams();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => {
    const requested = searchParams.get("tab");
    return SETTINGS_SECTIONS.some(section => section.key === requested) ? requested : "profile";
  });

  // Profile
  const [profileForm, setProfileForm] = useState({ name: "", phone: "", job_title: "", specialties: "" });
  const [saving, setSaving] = useState(false);

  // Password
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [showPw, setShowPw] = useState(false);

  // Signature
  const [signature, setSignature] = useState("");

  // 2FA
  const [twoFA, setTwoFA] = useState(null);
  const [setupData, setSetupData] = useState(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disablePw, setDisablePw] = useState("");
  const [showDisable2FA, setShowDisable2FA] = useState(false);

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState({});

  // Working Hours
  const [workHours, setWorkHours] = useState(null);

  // Display
  const [displayPrefs, setDisplayPrefs] = useState({});

  // Login Wallpaper
  const [wallpaperType, setWallpaperType] = useState("default");
  const [wallpaperUrl, setWallpaperUrl] = useState(null);
  const [wallpaperTemplates, setWallpaperTemplates] = useState([]);
  const [wallpaperUploading, setWallpaperUploading] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);

  // Gamification
  const [gamProfile, setGamProfile] = useState(null);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    setActiveTab(SETTINGS_SECTIONS.some(section => section.key === requestedTab) ? requestedTab : "profile");
  }, [searchParams]);

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectTab = (tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        axios.get(`${API}/user-settings/profile`, { headers }),
        axios.get(`${API}/user-settings/2fa`, { headers }),
        axios.get(`${API}/user-settings/notifications`, { headers }),
        axios.get(`${API}/user-settings/working-hours`, { headers }),
        axios.get(`${API}/user-settings/display`, { headers }),
      ]);
      const dataAt = (index, fallback) => results[index]?.status === "fulfilled" ? results[index].value.data : fallback;
      const profileData = dataAt(0, { name: user?.name || "", email: user?.email || "", role: user?.role || "technician" });
      const twoFactorData = dataAt(1, { enabled: false, security_keys: [] });
      const notificationData = dataAt(2, {});
      const hoursData = dataAt(3, null);
      const displayData = dataAt(4, {});

      setProfile(profileData);
      setProfileForm({
        name: profileData.name || "",
        phone: profileData.phone || "",
        job_title: profileData.job_title || "",
        specialties: (profileData.specialties || []).join(", "),
      });
      setSignature(profileData.email_signature || "");
      setGamProfile(profileData.gamification);
      setTwoFA(twoFactorData);
      setNotifPrefs(notificationData);
      setWorkHours(hoursData);
      setDisplayPrefs(displayData);
      if (results.some(result => result.status === "rejected")) toast.warning("Some settings could not be loaded. You can still use the available sections.");
      // Fetch wallpaper settings
      try {
        const [wpRes, tplRes] = await Promise.all([
          axios.get(`${API}/settings/login-wallpaper`, { headers }),
          axios.get(`${API}/settings/login-wallpaper/templates`, { headers }),
        ]);
        setWallpaperType(wpRes.data.type || "default");
        setWallpaperUrl(wpRes.data.url || null);
        setOverlayOpacity(wpRes.data.overlay_opacity ?? 0.7);
        setWallpaperTemplates(tplRes.data || []);
      } catch {}
    } catch { toast.error("Failed to load settings"); }
    finally { setLoading(false); }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/user-settings/profile`, {
        ...profileForm,
        specialties: profileForm.specialties.split(",").map(s => s.trim()).filter(Boolean),
        email_signature: signature,
      }, { headers });
      toast.success("Profile updated");
    } catch { toast.error("Failed to update profile"); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (pwForm.new_password !== pwForm.confirm_password) return toast.error("Passwords don't match");
    if (pwForm.new_password.length < 12) return toast.error("Use at least 12 characters");
    try {
      await axios.post(`${API}/user-settings/change-password`, { current_password: pwForm.current_password, new_password: pwForm.new_password }, { headers });
      toast.success("Password changed");
      setPwForm({ current_password: "", new_password: "", confirm_password: "" });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to change password"); }
  };

  const setup2FA = async () => {
    try {
      const res = await axios.post(`${API}/user-settings/2fa/setup`, {}, { headers });
      setSetupData(res.data);
    } catch { toast.error("Failed to set up 2FA"); }
  };

  const verify2FA = async () => {
    try {
      await axios.post(`${API}/user-settings/2fa/verify`, { code: verifyCode }, { headers });
      toast.success("2FA enabled");
      setSetupData(null);
      setVerifyCode("");
      const res = await axios.get(`${API}/user-settings/2fa`, { headers });
      setTwoFA(res.data);
    } catch { toast.error("Invalid code"); }
  };

  const disable2FA = async () => {
    try {
      await axios.post(`${API}/user-settings/2fa/disable`, { password: disablePw }, { headers });
      toast.success("2FA disabled");
      setShowDisable2FA(false);
      setDisablePw("");
      const res = await axios.get(`${API}/user-settings/2fa`, { headers });
      setTwoFA(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const saveNotifications = async () => {
    try {
      await axios.put(`${API}/user-settings/notifications`, notifPrefs, { headers });
      toast.success("Notification preferences saved");
    } catch { toast.error("Failed"); }
  };

  const saveWorkHours = async () => {
    try {
      await axios.put(`${API}/user-settings/working-hours`, workHours, { headers });
      toast.success("Working hours saved");
    } catch { toast.error("Failed"); }
  };

  const saveDisplay = async () => {
    try {
      await axios.put(`${API}/user-settings/display`, displayPrefs, { headers });
      toast.success("Display preferences saved");
    } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const level = gamProfile?.level || 1;
  const xp = gamProfile?.total_xp || 0;
  const nextLevelXp = level * 500;
  const xpProgress = Math.min(100, Math.round((xp % 500) / 5));
  const earnedBadges = gamProfile?.badges_earned || [];
  const activeSection = SETTINGS_SECTIONS.find(section => section.key === activeTab) || SETTINGS_SECTIONS[0];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 pb-8" data-testid="tech-settings-page">
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_8%_0%,hsl(var(--primary)/0.22),transparent_38%),linear-gradient(110deg,hsl(var(--card)),hsl(var(--background)))] p-4 shadow-[0_16px_48px_-28px_hsl(var(--primary)/0.55)] md:px-6 md:py-5">
        <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={() => window.history.back()} data-testid="settings-back" title="Go back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight md:text-2xl">My Workspace</h1>
                {profile?.role === "admin" && <Badge className="border-primary/20 bg-primary/10 text-primary"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Administrator</Badge>}
              </div>
              <p className="max-w-xl text-sm text-muted-foreground">Your technician command centre for profile, security, communications, availability, and workspace preferences.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/60 p-1.5 backdrop-blur-sm">
            <Button variant="outline" size="sm" onClick={() => selectTab("security")}><ShieldCheck className="mr-1.5 h-4 w-4" />Security</Button>
            <Button variant="outline" size="sm" onClick={() => selectTab("notifications")}><Bell className="mr-1.5 h-4 w-4" />Alerts</Button>
            <Button size="sm" onClick={fetchAll}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <Card className="border-primary/15 bg-gradient-to-b from-card to-muted/20 shadow-[0_12px_30px_-24px_hsl(var(--foreground)/0.7)]">
          <CardContent className="space-y-4 pt-5 text-center">
            <div className="w-16 h-16 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/35 to-primary/10 text-primary mx-auto flex items-center justify-center text-xl font-bold shadow-lg shadow-primary/10">
              {profile?.name?.split(" ").map(n => n[0]).join("") || "U"}
            </div>
            <div>
              <p className="font-semibold text-base tracking-tight">{profile?.name}</p>
              <p className="text-sm text-muted-foreground">{profile?.email}</p>
              <Badge variant="outline" className="mt-1 capitalize">{profile?.role}</Badge>
            </div>
            {gamProfile && (
              <>
                <Separator />
                <div data-testid="profile-level-card">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm font-bold">Level {level}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50 overflow-hidden mb-1">
                    <div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-500 transition-all" style={{ width: `${xpProgress}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{xp} / {nextLevelXp} XP</p>
                  {gamProfile.streak > 0 && (
                    <Badge className="mt-2 bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">
                      {gamProfile.streak} day streak
                    </Badge>
                  )}
                </div>
              </>
            )}
            <Separator />
            <nav className="grid grid-cols-1 gap-1.5 text-left sm:grid-cols-2 xl:grid-cols-4" aria-label="My settings sections">
              {SETTINGS_SECTIONS.map(item => (
                <button
                  key={item.key}
                  onClick={() => selectTab(item.key)}
                  className={`group w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${activeTab === item.key ? "border-primary/30 bg-primary/10 text-primary shadow-[0_8px_20px_-16px_hsl(var(--primary)/0.9)]" : "border-border/50 bg-background/35 text-muted-foreground hover:-translate-y-px hover:border-primary/20 hover:bg-muted/80 hover:text-foreground"}`}
                  data-testid={`settings-tab-${item.key}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium"><span className={`rounded-lg p-1.5 ${activeTab === item.key ? "bg-primary/15" : "bg-muted group-hover:bg-primary/10"}`}><item.icon className="h-3.5 w-3.5" /></span>{item.label}<ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" /></span>
                  <span className="ml-8 hidden pt-1 text-[11px] leading-snug opacity-75 xl:block">{item.description}</span>
                </button>
              ))}
            </nav>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/[0.08] to-card px-4 py-3.5">
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-2.5 text-primary shadow-sm"><activeSection.icon className="h-5 w-5" /></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">Workspace section</p><h2 className="font-semibold tracking-tight">{activeSection.label}</h2><p className="text-sm text-muted-foreground">{activeSection.description}</p></div>
          </div>

          {/* PROFILE TAB */}
          {activeTab === "profile" && (
            <Card data-testid="settings-profile-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5" />Profile Information</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Display Name</Label><Input value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} data-testid="profile-name" /></div>
                  <div><Label>Phone</Label><Input value={profileForm.phone} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })} data-testid="profile-phone" /></div>
                </div>
                <div><Label>Job Title</Label><Input value={profileForm.job_title} onChange={e => setProfileForm({ ...profileForm, job_title: e.target.value })} data-testid="profile-job-title" /></div>
                <div><Label>Specialties (comma separated)</Label><Input value={profileForm.specialties} onChange={e => setProfileForm({ ...profileForm, specialties: e.target.value })} placeholder="e.g., Networking, Cloud, Security" data-testid="profile-specialties" /></div>
                <Button onClick={saveProfile} disabled={saving} data-testid="save-profile-btn">{saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}Save Profile</Button>
              </CardContent>
            </Card>
          )}

          {/* SECURITY TAB */}
          {activeTab === "security" && (
            <div className="space-y-4">
              {/* Password Change */}
              <Card data-testid="settings-password-panel">
                <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" />Change Password</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div><Label>Current Password</Label>
                    <div className="relative">
                      <Input type={showPw ? "text" : "password"} value={pwForm.current_password} onChange={e => setPwForm({ ...pwForm, current_password: e.target.value })} data-testid="current-password" />
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>New Password</Label><Input type="password" value={pwForm.new_password} onChange={e => setPwForm({ ...pwForm, new_password: e.target.value })} data-testid="new-password" /></div>
                    <div><Label>Confirm New Password</Label><Input type="password" value={pwForm.confirm_password} onChange={e => setPwForm({ ...pwForm, confirm_password: e.target.value })} data-testid="confirm-password" /></div>
                  </div>
                  <p className="text-xs text-muted-foreground">Use 12+ characters and at least three of: lowercase, uppercase, number, and symbol. Avoid your email name.</p>
                  <Button onClick={changePassword} data-testid="change-password-btn">Change Password</Button>
                </CardContent>
              </Card>

              {/* 2FA */}
              <Card data-testid="settings-2fa-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" />Two-Factor Authentication</CardTitle>
                    {twoFA?.enabled && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Enabled</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!twoFA?.enabled && !setupData && (
                    <div className="flex items-center justify-between p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                      <div>
                        <p className="text-sm font-medium">2FA is not enabled</p>
                        <p className="text-xs text-muted-foreground">Add an extra layer of security to your account with TOTP-based authentication</p>
                      </div>
                      <Button onClick={setup2FA} data-testid="enable-2fa-btn"><Shield className="w-4 h-4 mr-1" />Enable 2FA</Button>
                    </div>
                  )}
                  {setupData && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg border bg-muted/30">
                        <p className="text-sm font-medium mb-2">Scan this QR code with your authenticator app:</p>
                        <div className="bg-white p-4 rounded-lg inline-block">
                          <div className="w-48 h-48 bg-muted flex items-center justify-center text-xs text-center p-2 text-black">
                            <div>
                              <Shield className="w-12 h-12 mx-auto mb-2 text-black" />
                              <p className="font-mono text-[10px] break-all">{setupData.secret}</p>
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">Or enter this key manually: <code className="bg-muted px-1 rounded font-mono">{setupData.secret}</code></p>
                      </div>
                      <div className="p-4 rounded-lg border bg-amber-500/5 border-amber-500/20">
                        <p className="text-sm font-medium mb-2">Backup Codes (save these securely):</p>
                        <div className="grid grid-cols-4 gap-2">
                          {setupData.backup_codes?.map((code, i) => (
                            <code key={`k-${i}`} className="text-xs bg-muted px-2 py-1 rounded text-center font-mono">{code}</code>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Input value={verifyCode} onChange={e => setVerifyCode(e.target.value)} placeholder="Enter 6-digit code" className="max-w-[200px] font-mono" data-testid="2fa-verify-code" />
                        <Button onClick={verify2FA} data-testid="verify-2fa-btn">Verify & Enable</Button>
                        <Button variant="ghost" onClick={() => setSetupData(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {twoFA?.enabled && !setupData && (
                    <div className="flex items-center justify-between p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                        <div>
                          <p className="text-sm font-medium text-emerald-400">2FA is active</p>
                          <p className="text-xs text-muted-foreground">{twoFA.backup_codes_remaining} backup codes remaining</p>
                        </div>
                      </div>
                      <Button variant="outline" className="text-destructive" onClick={() => setShowDisable2FA(true)} data-testid="disable-2fa-btn">Disable 2FA</Button>
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          )}

          {/* EMAIL SIGNATURE TAB */}
          {activeTab === "signature" && (
            <SignatureManager />
          )}

          {/* NOTIFICATIONS TAB */}
          {activeTab === "notifications" && (
            <Card data-testid="settings-notifications-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" />Notification Preferences</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {[
                  { title: "NexusMSP Notifications", items: [
                    { key: "inapp_ticket_assigned", label: "Ticket assigned", description: "When work is assigned directly to you" },
                    { key: "inapp_ticket_updated", label: "Ticket updates", description: "General updates on tickets you follow" },
                    { key: "inapp_ticket_escalated", label: "Ticket escalations", description: "Priority changes and escalations" },
                    { key: "inapp_sla_breach", label: "SLA breaches", description: "Critical response or resolution breaches" },
                    { key: "inapp_sla_warning", label: "SLA warnings", description: "Tickets approaching their SLA target" },
                    { key: "inapp_device_offline", label: "Device offline alerts", description: "Monitoring reports a device offline" },
                    { key: "inapp_contract_renewal", label: "Contract renewals", description: "Agreements approaching their renewal date" },
                    { key: "inapp_new_lead", label: "New leads", description: "Inbound or manually created lead records" },
                    { key: "inapp_email_received", label: "Email intake", description: "Incoming mailbox events and email-created work" },
                  ]},
                ].map(group => (
                  <div key={group.title}>
                    <h4 className="text-sm font-semibold mb-2">{group.title}</h4>
                    <div className="space-y-2">
                      {group.items.map(item => (
                        <div key={item.key} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/30" data-testid={`notif-${item.key}`}>
                          <div><span className="text-sm font-medium">{item.label}</span>{item.description && <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>}</div>
                          <Switch checked={!!notifPrefs[item.key]} onCheckedChange={v => setNotifPrefs({ ...notifPrefs, [item.key]: v })} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-muted bg-muted/20 p-3 text-xs text-muted-foreground">Email and SMS are sent by the relevant ticket, billing, lead, and monitoring workflows through their configured Microsoft 365 or SMS channel. They are not presented as personal toggles until individual delivery routing is available.</div>
                <Button onClick={saveNotifications} data-testid="save-notif-btn">Save Preferences</Button>
              </CardContent>
            </Card>
          )}

          {/* WORKING HOURS TAB */}
          {activeTab === "schedule" && workHours && (
            <Card data-testid="settings-schedule-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" />Working Hours & Availability</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Timezone</Label>
                    <Select value={workHours.timezone || "Australia/Sydney"} onValueChange={v => setWorkHours({ ...workHours, timezone: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Australia/Sydney", "Australia/Melbourne", "Pacific/Auckland", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "UTC"].map(tz => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4 pt-6">
                    <div className="flex items-center gap-2" data-testid="on-call-toggle">
                      <Switch checked={workHours.on_call} onCheckedChange={v => setWorkHours({ ...workHours, on_call: v })} />
                      <Label>On Call</Label>
                    </div>
                    <div className="flex items-center gap-2" data-testid="auto-assign-toggle">
                      <Switch checked={workHours.auto_assign} onCheckedChange={v => setWorkHours({ ...workHours, auto_assign: v })} />
                      <Label>Auto-Assign</Label>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Auto-assignment now considers this timezone and weekly schedule. On-call availability overrides normal hours; turn off Auto-Assign to keep tickets out of routing.</p>
                <div className="space-y-2">
                  {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => {
                    const d = workHours.schedule?.[day] || { enabled: false, start: "08:00", end: "17:00" };
                    return (
                      <div key={day} className={`flex items-center gap-4 p-3 rounded-lg border ${d.enabled ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20"}`} data-testid={`schedule-${day}`}>
                        <Switch checked={d.enabled} onCheckedChange={v => setWorkHours({
                          ...workHours,
                          schedule: { ...workHours.schedule, [day]: { ...d, enabled: v } }
                        })} />
                        <span className="text-sm font-medium capitalize w-24">{day}</span>
                        {d.enabled ? (
                          <div className="flex items-center gap-2">
                            <Input type="time" value={d.start} className="w-32" onChange={e => setWorkHours({
                              ...workHours,
                              schedule: { ...workHours.schedule, [day]: { ...d, start: e.target.value } }
                            })} />
                            <span className="text-muted-foreground">to</span>
                            <Input type="time" value={d.end} className="w-32" onChange={e => setWorkHours({
                              ...workHours,
                              schedule: { ...workHours.schedule, [day]: { ...d, end: e.target.value } }
                            })} />
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Day off</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button onClick={saveWorkHours} data-testid="save-schedule-btn">Save Schedule</Button>
              </CardContent>
            </Card>
          )}

          {/* DISPLAY TAB */}
          {activeTab === "display" && (
            <Card data-testid="settings-display-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5" />Appearance & Themes</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {/* Light/Dark Mode */}
                <div>
                  <Label className="text-sm font-medium">Mode</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Button variant={theme === "dark" ? "default" : "outline"} onClick={() => { if (theme !== "dark") toggleTheme(); }} data-testid="theme-dark"><Moon className="w-4 h-4 mr-1" />Dark</Button>
                    <Button variant={theme === "light" ? "default" : "outline"} onClick={() => { if (theme !== "light") toggleTheme(); }} data-testid="theme-light"><Settings className="w-4 h-4 mr-1" />Light</Button>
                  </div>
                </div>

                <Separator />

                {/* Theme Presets */}
                <div>
                  <Label className="text-sm font-medium">Theme Preset</Label>
                  <p className="text-xs text-muted-foreground mb-3">Choose a pre-built color scheme for the platform</p>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(THEME_PRESETS || {}).map(([key, p]) => (
                      <button
                        key={key}
                        onClick={() => { setPreset(key); if (p.accent) setAccent(p.accent); }}
                        className={`p-3 rounded-lg border text-left transition-all ${preset === key ? "border-primary ring-1 ring-primary" : "border-border/40 hover:border-border"}`}
                        data-testid={`preset-${key}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-4 rounded" style={{ background: p.bg }} />
                          <div className="w-4 h-4 rounded" style={{ background: p.sidebar }} />
                        </div>
                        <p className="text-sm font-medium">{p.label}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{p.accent} accent</p>
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Accent Color */}
                <div>
                  <Label className="text-sm font-medium">Accent Color</Label>
                  <p className="text-xs text-muted-foreground mb-3">Applied to buttons, links, and interactive elements</p>
                  <div className="flex gap-3">
                    {Object.keys(ACCENT_COLORS || {}).map(c => {
                      const colorMap = { emerald: "bg-emerald-500", blue: "bg-blue-500", cyan: "bg-cyan-500", violet: "bg-violet-500", orange: "bg-orange-500", red: "bg-red-500", sky: "bg-sky-500", rose: "bg-rose-500" };
                      return (
                        <button key={c} onClick={() => setAccent(c)}
                          className={`w-10 h-10 rounded-full ${colorMap[c]} transition-all ${accent === c ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110" : "opacity-60 hover:opacity-100"}`}
                          title={c}
                          data-testid={`accent-${c}`}
                        />
                      );
                    })}
                  </div>
                </div>

                <Separator />

                {/* Font Selection */}
                <div>
                  <Label className="text-sm font-medium">Font Family</Label>
                  <p className="text-xs text-muted-foreground mb-3">Changes the primary typeface across the platform</p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.keys(FONTS || {}).map(f => (
                      <button
                        key={f}
                        onClick={() => setFont(f)}
                        className={`p-3 rounded-lg border text-left transition-all ${font === f ? "border-primary bg-primary/5" : "border-border/40 hover:border-border"}`}
                        data-testid={`font-${f.replace(/\s/g, "-").toLowerCase()}`}
                      >
                        <p className="text-lg font-semibold mb-0.5" style={{ fontFamily: (FONTS || {})[f] || f }}>Aa</p>
                        <p className="text-xs text-muted-foreground">{f}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Login Wallpaper */}
                <div data-testid="wallpaper-section">
                  <Label className="text-sm font-medium flex items-center gap-2"><Image className="w-4 h-4" />Login Page Wallpaper</Label>
                  <p className="text-xs text-muted-foreground mb-3">Upload a custom 1920x1080 image or choose a template for the login page background</p>

                  {/* Current wallpaper preview */}
                  {wallpaperUrl && wallpaperType !== "default" && (
                    <div className="mb-3 rounded-lg overflow-hidden border border-border/40 relative group" data-testid="wallpaper-preview">
                      <img src={wallpaperUrl} alt="Login wallpaper" className="w-full h-32 object-cover" />
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-xs text-white font-medium">Current Wallpaper</span>
                      </div>
                    </div>
                  )}

                  {/* Wallpaper type selector */}
                  <div className="flex gap-2 mb-3">
                    <Button size="sm" variant={wallpaperType === "default" ? "default" : "outline"}
                      onClick={async () => {
                        setWallpaperType("default"); setWallpaperUrl(null);
                        await axios.put(`${API}/settings/login-wallpaper`, { type: "default", url: null }, { headers });
                        toast.success("Reset to default login background");
                      }} data-testid="wallpaper-default">Default</Button>
                    <Button size="sm" variant={wallpaperType === "template" ? "default" : "outline"}
                      onClick={() => setWallpaperType("template")} data-testid="wallpaper-template-btn">Templates</Button>
                    <Button size="sm" variant={wallpaperType === "custom" ? "default" : "outline"}
                      onClick={() => setWallpaperType("custom")} data-testid="wallpaper-custom-btn">
                      <Upload className="w-3 h-3 mr-1" />Upload
                    </Button>
                  </div>

                  {/* Template Gallery */}
                  {wallpaperType === "template" && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {wallpaperTemplates.map(tpl => (
                        <button key={tpl.id}
                          onClick={async () => {
                            setWallpaperUrl(tpl.url);
                            await axios.put(`${API}/settings/login-wallpaper`, { type: "template", url: tpl.url, overlay_opacity: overlayOpacity }, { headers });
                            toast.success(`Wallpaper set: ${tpl.name}`);
                          }}
                          className={`relative rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02] ${wallpaperUrl === tpl.url ? "border-primary ring-1 ring-primary" : "border-border/30"}`}
                          data-testid={`wallpaper-${tpl.id}`}
                        >
                          <img src={tpl.url} alt={tpl.name} className="w-full h-20 object-cover" loading="lazy" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
                            <p className="text-[10px] text-white font-medium">{tpl.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Custom Upload */}
                  {wallpaperType === "custom" && (
                    <div className="mb-3">
                      <div className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                        <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground mb-2">Drop an image or click to upload</p>
                        <p className="text-[10px] text-muted-foreground mb-3">Recommended: 1920x1080, JPG/PNG, max 10MB</p>
                        <input type="file" accept="image/*" className="hidden" id="wallpaper-upload"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setWallpaperUploading(true);
                            try {
                              const formData = new FormData();
                              formData.append("file", file);
                              const res = await axios.post(`${API}/settings/login-wallpaper/upload`, formData, {
                                headers: { ...headers, "Content-Type": "multipart/form-data" },
                              });
                              setWallpaperUrl(res.data.url);
                              toast.success("Wallpaper uploaded!");
                            } catch (err) { toast.error(err.response?.data?.detail || "Upload failed"); }
                            finally { setWallpaperUploading(false); }
                          }}
                          data-testid="wallpaper-upload-input"
                        />
                        <Button size="sm" variant="outline" disabled={wallpaperUploading}
                          onClick={() => document.getElementById("wallpaper-upload").click()}
                          data-testid="wallpaper-upload-btn">
                          {wallpaperUploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                          {wallpaperUploading ? "Uploading..." : "Choose Image"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Overlay opacity slider */}
                  {wallpaperType !== "default" && wallpaperUrl && (
                    <div className="mt-2">
                      <Label className="text-xs text-muted-foreground">Overlay Darkness: {Math.round(overlayOpacity * 100)}%</Label>
                      <input type="range" min="0.3" max="0.9" step="0.05" value={overlayOpacity}
                        onChange={async (e) => {
                          const val = parseFloat(e.target.value);
                          setOverlayOpacity(val);
                        }}
                        onMouseUp={async () => {
                          await axios.put(`${API}/settings/login-wallpaper`, { type: wallpaperType, url: wallpaperUrl, overlay_opacity: overlayOpacity }, { headers });
                        }}
                        className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer mt-1"
                        data-testid="wallpaper-opacity-slider"
                      />
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>
          )}

          {/* BADGES & AWARDS TAB */}
          {activeTab === "badges" && (
            <div className="space-y-4" data-testid="settings-badges-panel">
              {/* Stats Overview */}
              {gamProfile && (
                <div className="grid grid-cols-4 gap-3">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <Zap className="w-6 h-6 mx-auto text-yellow-500 mb-1" />
                      <p className="text-2xl font-bold">{xp}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Total XP</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <Star className="w-6 h-6 mx-auto text-purple-500 mb-1" />
                      <p className="text-2xl font-bold">{level}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Level</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <Trophy className="w-6 h-6 mx-auto text-amber-500 mb-1" />
                      <p className="text-2xl font-bold">{earnedBadges.length}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Badges</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <Award className="w-6 h-6 mx-auto text-orange-500 mb-1" />
                      <p className="text-2xl font-bold">{gamProfile.streak || 0}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Day Streak</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* All Badges */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5" />All Badges</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {BADGES.map(badge => {
                      const earned = earnedBadges.includes(badge.id);
                      return (
                        <div key={badge.id} className={`rounded-xl p-4 text-center border transition-all ${earned ? "border-current" : "opacity-40 border-muted"}`} style={earned ? { borderColor: badge.color + "60", background: badge.color + "08" } : {}} data-testid={`badge-${badge.id}`}>
                          <div className={`w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center ${earned ? "" : "bg-muted/30"}`} style={earned ? { background: badge.color + "20" } : {}}>
                            {badge.icon === "ticket" && <CheckCircle className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "zap" && <Zap className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "star" && <Star className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "moon" && <Globe className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "users" && <User className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "shield" && <Shield className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "cog" && <Settings className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                            {badge.icon === "book" && <Award className="w-7 h-7" style={{ color: earned ? badge.color : undefined }} />}
                          </div>
                          <p className="text-sm font-semibold" style={{ color: earned ? badge.color : undefined }}>{badge.label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{badge.description}</p>
                          {earned && <Badge className="mt-2 bg-emerald-500/10 text-emerald-400 text-[9px]">Earned</Badge>}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* XP Activity */}
              {gamProfile?.recent_xp && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Recent XP Activity</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(gamProfile.recent_xp || []).slice(0, 10).map((entry, i) => (
                        <div key={`k-${i}`} className="flex items-center justify-between p-2 rounded-lg border">
                          <div className="flex items-center gap-2">
                            <Zap className="w-3 h-3 text-yellow-500" />
                            <span className="text-sm">{entry.reason}</span>
                          </div>
                          <Badge className="bg-yellow-500/10 text-yellow-400 text-xs">+{entry.xp} XP</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={showDisable2FA} onOpenChange={setShowDisable2FA}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disable Two-Factor Authentication</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Enter your password to confirm disabling 2FA. This will remove all registered security keys as well.</p>
          <Input type="password" value={disablePw} onChange={e => setDisablePw(e.target.value)} placeholder="Enter password" data-testid="disable-2fa-password" />
          <DialogFooter><Button variant="destructive" onClick={disable2FA} data-testid="confirm-disable-2fa">Disable 2FA</Button></DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
