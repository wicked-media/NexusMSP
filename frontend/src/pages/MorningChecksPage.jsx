import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Activity, AlertTriangle, Server, Wifi, WifiOff, Shield, HardDrive,
  Clock, Users, CheckCircle, XCircle, RefreshCw, Loader2, Ticket,
  Phone, DollarSign, Calendar, ChevronRight, Zap, Mail, Send,
  Monitor, Laptop, Eye, TrendingDown, FileWarning, ArrowRight
} from "lucide-react";

const RAG = {
  red: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", dot: "bg-red-400", glow: "shadow-[0_0_12px_rgba(239,68,68,0.15)]" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", dot: "bg-amber-400", glow: "shadow-[0_0_12px_rgba(245,158,11,0.15)]" },
  green: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", dot: "bg-emerald-400", glow: "shadow-[0_0_12px_rgba(16,185,129,0.15)]" }
};

function HealthGauge({ score }) {
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const glowColor = score >= 80 ? "rgba(16,185,129,0.3)" : score >= 50 ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)";
  const label = score >= 80 ? "Healthy" : score >= 50 ? "Attention" : "Critical";
  return (
    <div className="relative w-36 h-36 group">
      <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ boxShadow: `0 0 40px ${glowColor}` }} />
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/10" />
        <circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - score / 100)}
          style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 6px ${glowColor})` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">{label}</span>
      </div>
    </div>
  );
}

function AnimatedCard({ children, className = "", delay = 0, ...props }) {
  return (
    <Card className={`transition-all duration-300 hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5 ${className}`}
      style={{ animationDelay: `${delay}ms`, animation: "fadeSlideIn 0.5s ease-out forwards", opacity: 0 }}
      {...props}>
      {children}
    </Card>
  );
}

export default function MorningChecksPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emailDialog, setEmailDialog] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/morning-checks`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load morning checks"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { toast.error("Enter a recipient email"); return; }
    setSending(true);
    try {
      const res = await axios.post(`${API}/morning-checks/send-email-report`, { to_email: emailTo.trim() }, { headers });
      if (res.data.resend_configured) {
        toast.success(res.data.message);
      } else {
        toast.success("Email report logged (configure Resend API key for live delivery)");
      }
      setEmailDialog(false);
      setEmailTo("");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to send email"); }
    finally { setSending(false); }
  };

  if (loading || !data) {
    return (
      <div className="space-y-6" data-testid="morning-checks-loading">
        <div className="h-28 rounded-2xl bg-gradient-to-br from-cyan-500/5 via-transparent to-violet-500/5 animate-pulse" />
        <div className="grid grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={`skel-${i}`}><CardContent className="p-6"><div className="h-16 rounded bg-muted animate-pulse" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const { devices, tickets, backups, security, client_health, phones, scheduled_tasks, recurring_due, patches_pending, overdue_invoices, health_score } = data;
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good Morning" : now.getHours() < 17 ? "Good Afternoon" : "Good Evening";

  const overallStatus = health_score >= 80 ? "operational" : health_score >= 50 ? "degraded" : "critical";
  const statusConfig = {
    operational: { label: "All Systems Operational", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    degraded: { label: "Attention Required", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    critical: { label: "Critical Issues Detected", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  };
  const sConf = statusConfig[overallStatus];

  const issueCount = devices.offline + tickets.critical_high + backups.failed + security.critical_alerts;

  return (
    <div className="space-y-5" data-testid="morning-checks">
      {/* Inline keyframes */}
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulseGlow { 0%,100% { opacity:.6; } 50% { opacity:1; } }
      `}</style>

      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/30" data-testid="morning-checks-hero">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/8 via-blue-500/5 to-violet-500/8" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.15) 0px, rgba(255,255,255,.15) 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, rgba(255,255,255,.15) 0px, rgba(255,255,255,.15) 1px, transparent 1px, transparent 40px)" }} />
        <div className="relative px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting} — <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Daily NOC Briefing</span></h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} — Generated {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${sConf.bg} ${sConf.color} ${sConf.border} border text-xs px-3 py-1`} data-testid="overall-status-badge">
              <div className={`w-2 h-2 rounded-full mr-2 ${overallStatus === "operational" ? "bg-emerald-400" : overallStatus === "degraded" ? "bg-amber-400" : "bg-red-400"}`} style={{ animation: "pulseGlow 2s ease-in-out infinite" }} />
              {sConf.label}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setEmailDialog(true)} className="gap-1.5 backdrop-blur-md border-border/40" data-testid="send-email-report-btn">
              <Mail className="w-4 h-4" />Email
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchData} data-testid="refresh-morning">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Email Report Dialog */}
      <Dialog open={emailDialog} onOpenChange={setEmailDialog}>
        <DialogContent className="max-w-md" aria-describedby="email-report-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-cyan-400" />Send Morning Check Email</DialogTitle>
            <DialogDescription id="email-report-desc">Send the current NOC morning check briefing as a formatted email report.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Recipient Email</Label>
              <Input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="team@yourcompany.com" className="mt-1" data-testid="email-report-to" />
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Report includes:</p>
              <p>Health Score: {health_score}% | {devices.offline} offline devices | {tickets.critical_high} critical tickets</p>
              <p>{backups.failed} backup failures | {security.critical_alerts} security alerts</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialog(false)}>Cancel</Button>
            <Button onClick={handleSendEmail} disabled={sending || !emailTo.trim()} data-testid="confirm-send-email-btn">
              {sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
              {sending ? "Sending..." : "Send Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Health Score + Key Metrics Row */}
      <div className="grid grid-cols-6 gap-3">
        <AnimatedCard className="col-span-1 flex items-center justify-center overflow-hidden" delay={0} data-testid="health-gauge">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-cyan-500/5" />
          <CardContent className="pt-4 pb-3 relative">
            <HealthGauge score={health_score} />
          </CardContent>
        </AnimatedCard>

        {[
          { label: "Devices Offline", value: devices.offline, total: devices.total, icon: WifiOff, color: devices.offline > 0 ? "text-red-400" : "text-emerald-400", gradient: devices.offline > 0 ? "from-red-500/15 to-red-600/5" : "from-emerald-500/15 to-emerald-600/5", danger: devices.offline > 0 },
          { label: "Critical Tickets", value: tickets.critical_high, total: tickets.total_open, icon: AlertTriangle, color: tickets.critical_high > 0 ? "text-red-400" : "text-emerald-400", gradient: tickets.critical_high > 0 ? "from-red-500/15 to-red-600/5" : "from-emerald-500/15 to-emerald-600/5", danger: tickets.critical_high > 0 },
          { label: "SLA Breaches", value: tickets.sla_breaches, icon: Clock, color: tickets.sla_breaches > 0 ? "text-red-400" : "text-emerald-400", gradient: tickets.sla_breaches > 0 ? "from-red-500/15 to-red-600/5" : "from-emerald-500/15 to-emerald-600/5", danger: tickets.sla_breaches > 0 },
          { label: "Backups Failed", value: backups.failed, total: backups.total, icon: HardDrive, color: backups.failed > 0 ? "text-red-400" : "text-emerald-400", gradient: backups.failed > 0 ? "from-red-500/15 to-red-600/5" : "from-emerald-500/15 to-emerald-600/5", danger: backups.failed > 0 },
          { label: "Security Alerts", value: security.critical_alerts, total: security.alerts_24h, icon: Shield, color: security.critical_alerts > 0 ? "text-amber-400" : "text-emerald-400", gradient: security.critical_alerts > 0 ? "from-amber-500/15 to-amber-600/5" : "from-emerald-500/15 to-emerald-600/5", danger: security.critical_alerts > 0 },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <AnimatedCard key={`mc-${i}`} delay={(i + 1) * 80}
              className={`overflow-hidden group ${s.danger ? "border-red-500/20" : ""}`}
              data-testid={`mc-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
              <CardContent className="pt-4 pb-3 relative">
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-0.5">{s.label}</p>
                    {s.total !== undefined && <p className="text-[9px] text-muted-foreground/50">of {s.total} total</p>}
                  </div>
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                    <Icon className={`w-6 h-6 ${s.color}`} />
                  </div>
                </div>
              </CardContent>
            </AnimatedCard>
          );
        })}
      </div>

      {/* Issues Summary Strip */}
      {issueCount > 0 && (
        <div className="flex gap-2 flex-wrap" data-testid="issues-strip">
          {devices.offline > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-red-500/10 border-red-500/20 text-red-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <WifiOff className="w-3.5 h-3.5" />{devices.offline} Offline Device{devices.offline > 1 ? "s" : ""}<ChevronRight className="w-3 h-3 opacity-50" />
            </div>
          )}
          {tickets.sla_breaches > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-red-500/10 border-red-500/20 text-red-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <Clock className="w-3.5 h-3.5" />{tickets.sla_breaches} SLA Breach{tickets.sla_breaches > 1 ? "es" : ""}<ChevronRight className="w-3 h-3 opacity-50" />
            </div>
          )}
          {backups.failed > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-orange-500/10 border-orange-500/20 text-orange-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <HardDrive className="w-3.5 h-3.5" />{backups.failed} Backup Failure{backups.failed > 1 ? "s" : ""}<ChevronRight className="w-3 h-3 opacity-50" />
            </div>
          )}
          {tickets.unassigned > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-purple-500/10 border-purple-500/20 text-purple-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <Ticket className="w-3.5 h-3.5" />{tickets.unassigned} Unassigned<ChevronRight className="w-3 h-3 opacity-50" />
            </div>
          )}
          {patches_pending > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-amber-500/10 border-amber-500/20 text-amber-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <Shield className="w-3.5 h-3.5" />{patches_pending} Critical Patches<ChevronRight className="w-3 h-3 opacity-50" />
            </div>
          )}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Offline Devices */}
          {devices.offline > 0 && (
            <AnimatedCard className="border-red-500/20 overflow-hidden" delay={200} data-testid="offline-devices">
              <div className="h-0.5 bg-gradient-to-r from-red-500 to-orange-500" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center"><WifiOff className="w-4 h-4 text-red-400" /></div>
                  Devices Offline
                  <Badge variant="destructive" className="text-[9px] h-4 px-1.5 ml-auto animate-pulse">{devices.offline}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {devices.offline_list.map((d, i) => (
                    <div key={`off-${i}`} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-red-400" style={{ animation: "pulseGlow 2s ease-in-out infinite" }} />
                        <span className="font-medium text-xs">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-muted-foreground">{d.client_name}</span>
                        <Badge variant="outline" className="text-[9px] border-border/40">{d.device_type}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </AnimatedCard>
          )}

          {/* Critical/High Tickets */}
          {tickets.critical_high > 0 && (
            <AnimatedCard className="border-amber-500/20 overflow-hidden" delay={280} data-testid="critical-tickets">
              <div className="h-0.5 bg-gradient-to-r from-amber-500 to-orange-500" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-amber-400" /></div>
                  Critical & High Tickets
                  <Badge className="text-[9px] h-4 px-1.5 ml-auto bg-amber-500/15 text-amber-400">{tickets.critical_high}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {tickets.critical_list.map((t, i) => (
                    <div key={`ct-${i}`} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-xs">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground">{t.client_name}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={`text-[9px] ${t.priority === "critical" ? "bg-red-500/15 text-red-400 border border-red-500/20" : "bg-orange-500/15 text-orange-400 border border-orange-500/20"}`}>{t.priority}</Badge>
                        <span className="text-[10px] text-muted-foreground">{t.assigned_name || "Unassigned"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </AnimatedCard>
          )}

          {/* Overnight New Tickets */}
          {tickets.overnight_new > 0 && (
            <AnimatedCard className="overflow-hidden" delay={360} data-testid="overnight-tickets">
              <div className="h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center"><Clock className="w-4 h-4 text-blue-400" /></div>
                  New Overnight Tickets
                  <Badge className="text-[9px] h-4 px-1.5 ml-auto bg-blue-500/15 text-blue-400">{tickets.overnight_new}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {tickets.overnight_list.map((t, i) => (
                    <div key={`ov-${i}`} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/10 transition-colors">
                      <div className="flex-1 min-w-0"><p className="truncate font-medium text-xs">{t.title}</p><p className="text-[10px] text-muted-foreground">{t.client_name}</p></div>
                      <Badge className={`text-[9px] ${t.priority === "critical" ? "bg-red-500/15 text-red-400" : t.priority === "high" ? "bg-orange-500/15 text-orange-400" : "bg-zinc-500/15 text-zinc-400"}`}>{t.priority}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </AnimatedCard>
          )}

          {/* Backup Failures */}
          {backups.failed > 0 && (
            <AnimatedCard className="border-red-500/20 overflow-hidden" delay={440} data-testid="failed-backups">
              <div className="h-0.5 bg-gradient-to-r from-red-500 to-pink-500" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center"><HardDrive className="w-4 h-4 text-red-400" /></div>
                  Failed Backups
                  <Badge variant="destructive" className="text-[9px] h-4 px-1.5 ml-auto">{backups.failed}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {backups.failed_list.map((b, i) => (
                    <div key={`fb-${i}`} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-colors">
                      <div><span className="font-medium text-xs">{b.name}</span><p className="text-[10px] text-muted-foreground">{b.client_name}</p></div>
                      <Badge variant="outline" className="text-[9px] border-border/40">{b.type}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </AnimatedCard>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Client Health RAG Board */}
          <AnimatedCard className="overflow-hidden" delay={200} data-testid="client-health">
            <div className="h-0.5 bg-gradient-to-r from-blue-500 to-violet-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center"><Users className="w-4 h-4 text-blue-400" /></div>
                Client Health Board
                <div className="flex items-center gap-3 ml-auto text-[10px]">
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400" />OK</span>
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-400" />Warn</span>
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-400" />Crit</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[280px]">
                <div className="space-y-1.5">
                  {client_health.map((c, i) => {
                    const rag = RAG[c.status] || RAG.green;
                    return (
                      <div key={`ch-${i}`} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all hover:scale-[1.01] ${rag.border} ${rag.bg}`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${rag.dot}`} style={c.status === "red" ? { animation: "pulseGlow 2s ease-in-out infinite" } : {}} />
                          <span className="font-medium text-sm">{c.client_name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-muted-foreground"><Server className="w-3 h-3 inline mr-0.5" />{c.devices_total - c.devices_offline}/{c.devices_total}</span>
                          {c.devices_offline > 0 && <span className="text-red-400 font-semibold">{c.devices_offline} offline</span>}
                          {c.critical_tickets > 0 && <span className="text-amber-400 font-semibold">{c.critical_tickets} critical</span>}
                          {c.backups_failed > 0 && <span className="text-red-400 font-semibold">{c.backups_failed} backup fail</span>}
                          <span className="text-muted-foreground">{c.open_tickets} tickets</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </AnimatedCard>

          {/* Quick Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Unassigned Tickets", value: tickets.unassigned, icon: Ticket, color: tickets.unassigned > 0 ? "text-purple-400" : "text-emerald-400", gradient: "from-purple-500/15 to-purple-600/5" },
              { label: "Critical Patches", value: patches_pending, icon: Shield, color: patches_pending > 0 ? "text-amber-400" : "text-emerald-400", gradient: "from-amber-500/15 to-amber-600/5" },
              { label: "Invoices Due", value: recurring_due.length, icon: DollarSign, color: recurring_due.length > 0 ? "text-violet-400" : "text-zinc-400", gradient: "from-violet-500/15 to-violet-600/5" },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <AnimatedCard key={`qs-${i}`} delay={280 + i * 80} className="overflow-hidden group" data-testid={`${s.label.toLowerCase().replace(/\s/g, "-")}-stat`}>
                  <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  <CardContent className="pt-3 pb-2 relative">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{s.label}</p>
                      </div>
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                        <Icon className={`w-4 h-4 ${s.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </AnimatedCard>
              );
            })}
          </div>

          {/* Overdue Invoices */}
          {overdue_invoices.count > 0 && (
            <AnimatedCard className="border-amber-500/20 overflow-hidden" delay={520} data-testid="overdue-invoices">
              <div className="h-0.5 bg-gradient-to-r from-amber-500 to-yellow-500" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-amber-400" /></div>
                  Overdue Invoices
                  <span className="ml-auto text-xs text-amber-400 font-mono font-bold">${overdue_invoices.total_amount?.toLocaleString()}</span>
                  <Badge className="text-[9px] h-4 px-1.5 bg-amber-500/15 text-amber-400">{overdue_invoices.count}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {overdue_invoices.list.map((inv, i) => (
                    <div key={`oi-${i}`} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 transition-colors">
                      <div><span className="font-mono text-xs font-semibold">{inv.invoice_number}</span><span className="text-xs text-muted-foreground ml-2">{inv.client_name}</span></div>
                      <span className="font-mono text-xs text-amber-400 font-bold">${inv.amount_due?.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </AnimatedCard>
          )}

          {/* Phone System */}
          <AnimatedCard className="overflow-hidden" delay={600} data-testid="phone-status">
            <div className="h-0.5 bg-gradient-to-r from-cyan-500 to-teal-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Phone className="w-4 h-4 text-cyan-400" /></div>
                Phone System (Yeastar)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {phones.configured ? (
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                  <CheckCircle className="w-4 h-4 text-emerald-400" /><span className="text-sm font-medium">Yeastar PBX Connected</span>
                  <div className="w-2 h-2 rounded-full bg-emerald-400 ml-auto" style={{ animation: "pulseGlow 2s ease-in-out infinite" }} />
                </div>
              ) : (
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/30 border border-border/40">
                  <XCircle className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Yeastar PBX not configured</span>
                  <a href="/settings" className="text-cyan-400 text-xs hover:underline ml-auto">Setup</a>
                </div>
              )}
            </CardContent>
          </AnimatedCard>

          {/* Scheduled Tasks */}
          {scheduled_tasks.length > 0 && (
            <AnimatedCard className="overflow-hidden" delay={680} data-testid="scheduled-tasks">
              <div className="h-0.5 bg-gradient-to-r from-violet-500 to-purple-500" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center"><Calendar className="w-4 h-4 text-violet-400" /></div>
                  Scheduled Tasks Today
                  <Badge className="text-[9px] h-4 px-1.5 ml-auto bg-violet-500/15 text-violet-400">{scheduled_tasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {scheduled_tasks.map((t, i) => (
                    <div key={`st-${i}`} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10 hover:bg-violet-500/10 transition-colors">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground font-mono">{t.schedule_time}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </AnimatedCard>
          )}
        </div>
      </div>

      {/* All Green Message */}
      {devices.offline === 0 && tickets.critical_high === 0 && backups.failed === 0 && security.critical_alerts === 0 && (
        <AnimatedCard className="border-emerald-500/20 overflow-hidden" delay={300} data-testid="all-clear">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-transparent to-cyan-500/5" />
          <CardContent className="py-6 flex items-center justify-center gap-3 relative">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="font-bold text-emerald-400">All Systems Operational</p>
              <p className="text-sm text-muted-foreground">No critical issues detected. Great start to the day!</p>
            </div>
          </CardContent>
        </AnimatedCard>
      )}
    </div>
  );
}
