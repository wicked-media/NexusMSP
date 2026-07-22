import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import HeroTile from "@/components/HeroTile";
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
  const navigate = useNavigate();
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
      if (res.data.email_configured) {
        toast.success(res.data.message);
      } else {
        toast.success("Email report logged (connect Microsoft 365 for live delivery)");
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
      <section className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.10] via-background to-background p-5 md:p-6" data-testid="morning-checks-hero">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/8 via-blue-500/5 to-violet-500/8" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.15) 0px, rgba(255,255,255,.15) 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, rgba(255,255,255,.15) 0px, rgba(255,255,255,.15) 1px, transparent 1px, transparent 40px)" }} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">Daily operations</p>
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
      </section>

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

      {/* Standard command tiles — shared with Tickets, Devices and Billing */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" data-testid="morning-check-metric-strip">
        <HeroTile label="Fleet Health" value={`${health_score}%`} subtitle={sConf.label} icon={Activity} glow={overallStatus === "critical" ? "rose" : overallStatus === "degraded" ? "amber" : "emerald"} onClick={() => navigate("/devices")} testId="mc-health-score" />
        <HeroTile label="Offline" value={devices.offline} subtitle={`${devices.total} monitored`} icon={WifiOff} glow={devices.offline > 0 ? "rose" : "emerald"} onClick={() => navigate("/devices")} testId="mc-devices-offline" />
        <HeroTile label="Critical Tickets" value={tickets.critical_high} subtitle={`${tickets.total_open} open`} icon={AlertTriangle} glow={tickets.critical_high > 0 ? "rose" : "emerald"} onClick={() => navigate("/tickets?attention=critical_high")} testId="mc-critical-tickets" />
        <HeroTile label="SLA Breaches" value={tickets.sla_breaches} subtitle="Requires response" icon={Clock} glow={tickets.sla_breaches > 0 ? "rose" : "emerald"} onClick={() => navigate("/tickets?attention=sla_breach")} testId="mc-sla-breaches" />
        <HeroTile label="Backup Failures" value={backups.failed} subtitle={`${backups.total} jobs`} icon={HardDrive} glow={backups.failed > 0 ? "rose" : "emerald"} onClick={() => navigate("/backup-center")} testId="mc-backups-failed" />
        <HeroTile label="Security Alerts" value={security.critical_alerts} subtitle={`${security.alerts_24h} in 24h`} icon={Shield} glow={security.critical_alerts > 0 ? "amber" : "emerald"} onClick={() => navigate("/notifications?severity=critical")} testId="mc-security-alerts" />
      </div>

      {/* Issues Summary Strip */}
      {issueCount > 0 && (
        <div className="flex gap-2 flex-wrap" data-testid="issues-strip">
          {devices.offline > 0 && (
            <button type="button" onClick={() => navigate("/devices")} className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-red-500/10 border-red-500/20 text-red-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <WifiOff className="w-3.5 h-3.5" />{devices.offline} Offline Device{devices.offline > 1 ? "s" : ""}<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          )}
          {tickets.sla_breaches > 0 && (
            <button type="button" onClick={() => navigate("/tickets?attention=sla_breach")} className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-red-500/10 border-red-500/20 text-red-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <Clock className="w-3.5 h-3.5" />{tickets.sla_breaches} SLA Breach{tickets.sla_breaches > 1 ? "es" : ""}<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          )}
          {backups.failed > 0 && (
            <button type="button" onClick={() => navigate("/backup-center")} className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-orange-500/10 border-orange-500/20 text-orange-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <HardDrive className="w-3.5 h-3.5" />{backups.failed} Backup Failure{backups.failed > 1 ? "s" : ""}<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          )}
          {tickets.unassigned > 0 && (
            <button type="button" onClick={() => navigate("/tickets?attention=unassigned")} className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-purple-500/10 border-purple-500/20 text-purple-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <Ticket className="w-3.5 h-3.5" />{tickets.unassigned} Unassigned<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          )}
          {patches_pending > 0 && (
            <button type="button" onClick={() => navigate("/maintenance-scheduler")} className="flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold bg-amber-500/10 border-amber-500/20 text-amber-400 transition-all hover:scale-[1.03] hover:shadow-lg" style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}>
              <Shield className="w-3.5 h-3.5" />{patches_pending} Critical Patches<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          )}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
                    <button type="button" key={`off-${i}`} onClick={() => d.id && navigate(`/devices/${d.id}`)} className="flex w-full items-center justify-between text-left text-sm px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-red-400" style={{ animation: "pulseGlow 2s ease-in-out infinite" }} />
                        <span className="font-medium text-xs">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-muted-foreground">{d.client_name}</span>
                        <Badge variant="outline" className="text-[9px] border-border/40">{d.device_type}</Badge>
                      </div>
                    </button>
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
                    <button type="button" key={`ct-${i}`} onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(t.id)}`)} className="flex w-full items-center justify-between text-left text-sm px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-xs">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground">{t.client_name}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={`text-[9px] ${t.priority === "critical" ? "bg-red-500/15 text-red-400 border border-red-500/20" : "bg-orange-500/15 text-orange-400 border border-orange-500/20"}`}>{t.priority}</Badge>
                        <span className="text-[10px] text-muted-foreground">{t.assigned_name || "Unassigned"}</span>
                      </div>
                    </button>
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
                    <button type="button" key={`ov-${i}`} onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(t.id)}`)} className="flex w-full items-center justify-between text-left text-sm px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/10 transition-colors">
                      <div className="flex-1 min-w-0"><p className="truncate font-medium text-xs">{t.title}</p><p className="text-[10px] text-muted-foreground">{t.client_name}</p></div>
                      <Badge className={`text-[9px] ${t.priority === "critical" ? "bg-red-500/15 text-red-400" : t.priority === "high" ? "bg-orange-500/15 text-orange-400" : "bg-zinc-500/15 text-zinc-400"}`}>{t.priority}</Badge>
                    </button>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HeroTile label="Unassigned" value={tickets.unassigned} subtitle="Tickets awaiting triage" icon={Ticket} glow={tickets.unassigned > 0 ? "violet" : "emerald"} onClick={() => navigate("/tickets?attention=unassigned")} testId="mc-unassigned-tickets" />
            <HeroTile label="Critical Patches" value={patches_pending} subtitle="Pending remediation" icon={Shield} glow={patches_pending > 0 ? "amber" : "emerald"} onClick={() => navigate("/maintenance-scheduler")} testId="mc-critical-patches" />
            <HeroTile label="Recurring Due" value={recurring_due.length} subtitle="Billing runs to review" icon={DollarSign} glow={recurring_due.length > 0 ? "violet" : "emerald"} onClick={() => navigate("/recurring-invoices")} testId="mc-recurring-due" />
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
