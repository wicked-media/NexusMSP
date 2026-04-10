import { useState, useEffect } from "react";
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
import {
  User, Lock, Mail, Shield, Key, Bell, Clock, Palette, Globe, Award, Trophy,
  Star, Zap, Plus, Trash2, Copy, Eye, EyeOff, Monitor, Smartphone, LogOut,
  CheckCircle, XCircle, Fingerprint, ArrowLeft, Loader2, ChevronRight, Settings
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

export default function TechSettingsPage() {
  const { user, token } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const headers = { Authorization: `Bearer ${token}` };

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("profile");

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

  // Security Keys
  const [securityKeys, setSecurityKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [showAddKey, setShowAddKey] = useState(false);

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState({});

  // Working Hours
  const [workHours, setWorkHours] = useState(null);

  // API Keys
  const [apiKeys, setApiKeys] = useState([]);
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showNewKey, setShowNewKey] = useState(null);
  const [showAddApiKey, setShowAddApiKey] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState([]);

  // Display
  const [displayPrefs, setDisplayPrefs] = useState({});

  // Gamification
  const [gamProfile, setGamProfile] = useState(null);

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [pRes, tfRes, nRes, wRes, aRes, sRes, dRes] = await Promise.all([
        axios.get(`${API}/user-settings/profile`, { headers }),
        axios.get(`${API}/user-settings/2fa`, { headers }),
        axios.get(`${API}/user-settings/notifications`, { headers }),
        axios.get(`${API}/user-settings/working-hours`, { headers }),
        axios.get(`${API}/user-settings/api-keys`, { headers }),
        axios.get(`${API}/user-settings/sessions`, { headers }),
        axios.get(`${API}/user-settings/display`, { headers }),
      ]);
      setProfile(pRes.data);
      setProfileForm({
        name: pRes.data.name || "",
        phone: pRes.data.phone || "",
        job_title: pRes.data.job_title || "",
        specialties: (pRes.data.specialties || []).join(", "),
      });
      setSignature(pRes.data.email_signature || "");
      setGamProfile(pRes.data.gamification);
      setTwoFA(tfRes.data);
      setSecurityKeys(tfRes.data.security_keys || []);
      setNotifPrefs(nRes.data);
      setWorkHours(wRes.data);
      setApiKeys(aRes.data);
      setSessions(sRes.data);
      setDisplayPrefs(dRes.data);
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
    if (pwForm.new_password.length < 6) return toast.error("Password must be at least 6 characters");
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

  const addSecurityKey = async () => {
    try {
      const res = await axios.post(`${API}/user-settings/security-keys/register`, { name: newKeyName || "Security Key" }, { headers });
      toast.success(res.data.message);
      setNewKeyName("");
      setShowAddKey(false);
      const tfRes = await axios.get(`${API}/user-settings/2fa`, { headers });
      setSecurityKeys(tfRes.data.security_keys || []);
    } catch { toast.error("Failed to register key"); }
  };

  const removeSecurityKey = async (keyId) => {
    try {
      await axios.delete(`${API}/user-settings/security-keys/${keyId}`, { headers });
      setSecurityKeys(prev => prev.filter(k => k.id !== keyId));
      toast.success("Key removed");
    } catch { toast.error("Failed"); }
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

  const createApiKey = async () => {
    try {
      const res = await axios.post(`${API}/user-settings/api-keys`, { name: newApiKeyName || "API Key" }, { headers });
      setShowNewKey(res.data.key);
      setNewApiKeyName("");
      setShowAddApiKey(false);
      const aRes = await axios.get(`${API}/user-settings/api-keys`, { headers });
      setApiKeys(aRes.data);
      toast.success("API key created");
    } catch { toast.error("Failed"); }
  };

  const deleteApiKey = async (keyId) => {
    try {
      await axios.delete(`${API}/user-settings/api-keys/${keyId}`, { headers });
      setApiKeys(prev => prev.filter(k => k.id !== keyId));
      toast.success("API key revoked");
    } catch { toast.error("Failed"); }
  };

  const revokeSession = async (sessionId) => {
    try {
      await axios.delete(`${API}/user-settings/sessions/${sessionId}`, { headers });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      toast.success("Session revoked");
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

  return (
    <div className="space-y-5" data-testid="tech-settings-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()} data-testid="settings-back">
          <ArrowLeft className="w-4 h-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account, security, and preferences</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left: Profile Card */}
        <Card className="lg:col-span-1 h-fit">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-primary/20 text-primary mx-auto flex items-center justify-center text-2xl font-bold">
              {profile?.name?.split(" ").map(n => n[0]).join("") || "U"}
            </div>
            <div>
              <p className="font-semibold text-lg">{profile?.name}</p>
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
            <nav className="space-y-1 text-left">
              {[
                { key: "profile", icon: User, label: "Profile" },
                { key: "security", icon: Lock, label: "Security" },
                { key: "signature", icon: Mail, label: "Email Signature" },
                { key: "notifications", icon: Bell, label: "Notifications" },
                { key: "schedule", icon: Clock, label: "Working Hours" },
                { key: "api", icon: Key, label: "API Keys" },
                { key: "sessions", icon: Monitor, label: "Sessions" },
                { key: "display", icon: Palette, label: "Display" },
                { key: "badges", icon: Trophy, label: "Badges & Awards" },
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${activeTab === item.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}
                  data-testid={`settings-tab-${item.key}`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                  <ChevronRight className="w-3 h-3 ml-auto opacity-50" />
                </button>
              ))}
            </nav>
          </CardContent>
        </Card>

        {/* Right: Settings Content */}
        <div className="lg:col-span-3 space-y-4">

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

              {/* FIDO2 Security Keys */}
              <Card data-testid="settings-fido2-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Fingerprint className="w-5 h-5" />Security Keys (FIDO2)</CardTitle>
                    <Button size="sm" onClick={() => setShowAddKey(true)} data-testid="add-security-key-btn"><Plus className="w-3 h-3 mr-1" />Add Key</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {securityKeys.length > 0 ? (
                    <div className="space-y-2">
                      {securityKeys.map(key => (
                        <div key={key.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30" data-testid={`security-key-${key.id}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Fingerprint className="w-5 h-5 text-blue-500" /></div>
                            <div>
                              <p className="text-sm font-medium">{key.name}</p>
                              <p className="text-[10px] text-muted-foreground">Registered: {key.registered_at?.split("T")[0]} {key.last_used ? `| Last used: ${key.last_used.split("T")[0]}` : ""}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => removeSecurityKey(key.id)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Fingerprint className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                      <p className="text-sm text-muted-foreground">No security keys registered</p>
                      <p className="text-xs text-muted-foreground mt-1">Add a FIDO2/WebAuthn security key for passwordless login</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* EMAIL SIGNATURE TAB */}
          {activeTab === "signature" && (
            <Card data-testid="settings-signature-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" />Email Signature</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">This signature will be automatically appended to outgoing emails from tickets.</p>
                <textarea
                  className="w-full min-h-[200px] rounded-lg border bg-background p-3 text-sm font-mono resize-y focus:ring-1 focus:ring-primary"
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  placeholder="e.g., Best regards,&#10;Alex Thompson&#10;Senior Engineer | NexusOps&#10;Phone: +64 21 123 4567"
                  data-testid="email-signature-input"
                />
                {signature && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Preview:</Label>
                    <div className="p-3 rounded-lg border bg-muted/20 text-sm whitespace-pre-wrap">{signature}</div>
                  </div>
                )}
                <Button onClick={saveProfile} data-testid="save-signature-btn">Save Signature</Button>
              </CardContent>
            </Card>
          )}

          {/* NOTIFICATIONS TAB */}
          {activeTab === "notifications" && (
            <Card data-testid="settings-notifications-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" />Notification Preferences</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {[
                  { title: "Email Notifications", items: [
                    { key: "email_ticket_assigned", label: "Ticket assigned to me" },
                    { key: "email_ticket_updated", label: "Ticket updates" },
                    { key: "email_sla_breach", label: "SLA breach alerts" },
                    { key: "email_daily_digest", label: "Daily digest summary" },
                  ]},
                  { title: "In-App Notifications", items: [
                    { key: "inapp_ticket_assigned", label: "Ticket assigned" },
                    { key: "inapp_ticket_updated", label: "Ticket updates" },
                    { key: "inapp_sla_breach", label: "SLA breach alerts" },
                    { key: "inapp_device_offline", label: "Device offline alerts" },
                  ]},
                  { title: "SMS / Critical Alerts", items: [
                    { key: "sms_critical_alerts", label: "Critical priority tickets" },
                    { key: "sms_sla_breach", label: "SLA breach (SMS)" },
                  ]},
                  { title: "Desktop", items: [
                    { key: "desktop_notifications", label: "Browser push notifications" },
                    { key: "sound_enabled", label: "Notification sounds" },
                  ]},
                ].map(group => (
                  <div key={group.title}>
                    <h4 className="text-sm font-semibold mb-2">{group.title}</h4>
                    <div className="space-y-2">
                      {group.items.map(item => (
                        <div key={item.key} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/30" data-testid={`notif-${item.key}`}>
                          <span className="text-sm">{item.label}</span>
                          <Switch checked={!!notifPrefs[item.key]} onCheckedChange={v => setNotifPrefs({ ...notifPrefs, [item.key]: v })} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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
                    <Select value={workHours.timezone || "Pacific/Auckland"} onValueChange={v => setWorkHours({ ...workHours, timezone: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Pacific/Auckland", "Australia/Sydney", "Australia/Melbourne", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "UTC"].map(tz => (
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

          {/* API KEYS TAB */}
          {activeTab === "api" && (
            <Card data-testid="settings-api-panel">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" />API Keys</CardTitle>
                  <Button size="sm" onClick={() => setShowAddApiKey(true)} data-testid="create-api-key-btn"><Plus className="w-3 h-3 mr-1" />New Key</Button>
                </div>
              </CardHeader>
              <CardContent>
                {showNewKey && (
                  <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 mb-4" data-testid="new-api-key-display">
                    <p className="text-sm font-medium text-emerald-400 mb-1">New API Key Created (copy it now, it won't be shown again):</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted px-3 py-2 rounded font-mono text-sm">{showNewKey}</code>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(showNewKey); toast.success("Copied"); }}><Copy className="w-3 h-3" /></Button>
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setShowNewKey(null)}>Dismiss</Button>
                  </div>
                )}
                {apiKeys.length > 0 ? (
                  <div className="space-y-2">
                    {apiKeys.map(key => (
                      <div key={key.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30" data-testid={`api-key-${key.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><Key className="w-5 h-5 text-amber-500" /></div>
                          <div>
                            <p className="text-sm font-medium">{key.name}</p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <code className="font-mono">{key.prefix}</code>
                              <span>Created: {key.created_at?.split("T")[0]}</span>
                              {key.scopes && <Badge variant="outline" className="text-[9px] h-4">{key.scopes.join(", ")}</Badge>}
                            </div>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => deleteApiKey(key.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Key className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                    <p className="text-sm text-muted-foreground">No API keys created</p>
                    <p className="text-xs text-muted-foreground mt-1">Create personal API tokens for third-party integrations and scripts</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* SESSIONS TAB */}
          {activeTab === "sessions" && (
            <Card data-testid="settings-sessions-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Monitor className="w-5 h-5" />Active Sessions</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sessions.map(s => (
                    <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg border ${s.is_current ? "border-emerald-500/20 bg-emerald-500/5" : "hover:bg-muted/30"}`} data-testid={`session-${s.id}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.is_current ? "bg-emerald-500/10" : "bg-muted"}`}>
                          {s.device?.toLowerCase().includes("mobile") ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium flex items-center gap-2">
                            {s.device || "Unknown Device"}
                            {s.is_current && <Badge className="bg-emerald-500/20 text-emerald-400 text-[9px]">Current</Badge>}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{s.ip_address}</span>
                            {s.location && <span>| {s.location}</span>}
                            <span>| Last active: {s.last_active?.split("T")[0]}</span>
                          </div>
                        </div>
                      </div>
                      {!s.is_current && (
                        <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => revokeSession(s.id)}>
                          <LogOut className="w-3 h-3 mr-1" />Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* DISPLAY TAB */}
          {activeTab === "display" && (
            <Card data-testid="settings-display-panel">
              <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5" />Display & Preferences</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Theme</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Button variant={theme === "dark" ? "default" : "outline"} onClick={() => { if (theme !== "dark") toggleTheme(); }} data-testid="theme-dark"><Moon className="w-4 h-4 mr-1" />Dark</Button>
                    <Button variant={theme === "light" ? "default" : "outline"} onClick={() => { if (theme !== "light") toggleTheme(); }} data-testid="theme-light"><Settings className="w-4 h-4 mr-1" />Light</Button>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Accent Color</Label>
                    <div className="flex gap-2 mt-2">
                      {[
                        { name: "blue", class: "bg-blue-500" }, { name: "purple", class: "bg-purple-500" },
                        { name: "green", class: "bg-emerald-500" }, { name: "orange", class: "bg-orange-500" },
                        { name: "red", class: "bg-red-500" }, { name: "cyan", class: "bg-cyan-500" },
                      ].map(c => (
                        <button key={c.name} onClick={() => setDisplayPrefs({ ...displayPrefs, accent_color: c.name })}
                          className={`w-8 h-8 rounded-full ${c.class} transition-all ${displayPrefs.accent_color === c.name ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110" : "opacity-70 hover:opacity-100"}`}
                          data-testid={`accent-${c.name}`} />
                      ))}
                    </div>
                  </div>
                  <div><Label>Date Format</Label>
                    <Select value={displayPrefs.date_format || "MMM d, yyyy"} onValueChange={v => setDisplayPrefs({ ...displayPrefs, date_format: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MMM d, yyyy">Mar 20, 2026</SelectItem>
                        <SelectItem value="dd/MM/yyyy">20/03/2026</SelectItem>
                        <SelectItem value="MM/dd/yyyy">03/20/2026</SelectItem>
                        <SelectItem value="yyyy-MM-dd">2026-03-20</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Timezone</Label>
                    <Select value={displayPrefs.timezone || "Pacific/Auckland"} onValueChange={v => setDisplayPrefs({ ...displayPrefs, timezone: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Pacific/Auckland", "Australia/Sydney", "Australia/Melbourne", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "UTC"].map(tz => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Language</Label>
                    <Select value={displayPrefs.language || "en"} onValueChange={v => setDisplayPrefs({ ...displayPrefs, language: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                        <SelectItem value="de">German</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-2.5 rounded-lg border">
                    <div><p className="text-sm">Compact Mode</p><p className="text-xs text-muted-foreground">Reduce spacing for more content</p></div>
                    <Switch checked={displayPrefs.compact_mode} onCheckedChange={v => setDisplayPrefs({ ...displayPrefs, compact_mode: v })} />
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border">
                    <div><p className="text-sm">Ticket Previews</p><p className="text-xs text-muted-foreground">Show ticket preview on hover</p></div>
                    <Switch checked={displayPrefs.show_ticket_previews !== false} onCheckedChange={v => setDisplayPrefs({ ...displayPrefs, show_ticket_previews: v })} />
                  </div>
                </div>
                <Button onClick={saveDisplay} data-testid="save-display-btn">Save Display Settings</Button>
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

      <Dialog open={showAddKey} onOpenChange={setShowAddKey}>
        <DialogContent>
          <DialogHeader><DialogTitle>Register Security Key</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Insert your FIDO2/WebAuthn security key and give it a name.</p>
          <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="e.g., YubiKey 5" data-testid="security-key-name" />
          <DialogFooter><Button onClick={addSecurityKey} data-testid="register-key-btn"><Fingerprint className="w-4 h-4 mr-1" />Register Key</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddApiKey} onOpenChange={setShowAddApiKey}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create API Key</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Generate a personal API token for integrations and scripts.</p>
          <Input value={newApiKeyName} onChange={e => setNewApiKeyName(e.target.value)} placeholder="e.g., Monitoring Script" data-testid="api-key-name" />
          <DialogFooter><Button onClick={createApiKey} data-testid="create-key-btn"><Key className="w-4 h-4 mr-1" />Create Key</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
