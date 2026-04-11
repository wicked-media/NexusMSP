import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Server, Wifi, WifiOff, Shield, HardDrive,
  Clock, Users, CheckCircle, XCircle, RefreshCw, Loader2, Ticket,
  Phone, DollarSign, Calendar, ChevronRight, Zap
} from "lucide-react";

const RAG = { red: { bg: "bg-red-500/15", border: "border-red-500/30", text: "text-red-400", dot: "bg-red-400" }, amber: { bg: "bg-amber-500/15", border: "border-amber-500/30", text: "text-amber-400", dot: "bg-amber-400" }, green: { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-400", dot: "bg-emerald-400" } };

function HealthGauge({ score }) {
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Healthy" : score >= 50 ? "Attention" : "Critical";
  return (
    <div className="relative w-32 h-32">
      <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/15" />
        <circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - score / 100)} style={{ transition: "stroke-dashoffset 1.2s ease-in-out" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
}

export default function MorningChecksPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
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

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { devices, tickets, backups, security, client_health, phones, scheduled_tasks, recurring_due, patches_pending, overdue_invoices, health_score } = data;
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good Morning" : now.getHours() < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <div className="space-y-5" data-testid="morning-checks">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greeting} - Daily Checks</h1>
          <p className="text-muted-foreground">NOC daily briefing - {now.toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Generated: {now.toLocaleTimeString()}</span>
          <Button variant="outline" size="sm" onClick={fetchData} data-testid="refresh-morning"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* Top Row: Health Gauge + Critical Counts */}
      <div className="grid grid-cols-6 gap-3">
        <Card className="col-span-1 flex items-center justify-center" data-testid="health-gauge">
          <CardContent className="pt-4 pb-3"><HealthGauge score={health_score} /></CardContent>
        </Card>
        {[
          { label: "Devices Offline", value: devices.offline, total: devices.total, icon: WifiOff, color: devices.offline > 0 ? "text-red-400" : "text-emerald-400", bg: devices.offline > 0 ? "bg-red-500/10" : "bg-emerald-500/10", danger: devices.offline > 0 },
          { label: "Critical Tickets", value: tickets.critical_high, total: tickets.total_open, icon: AlertTriangle, color: tickets.critical_high > 0 ? "text-red-400" : "text-emerald-400", bg: tickets.critical_high > 0 ? "bg-red-500/10" : "bg-emerald-500/10", danger: tickets.critical_high > 0 },
          { label: "SLA Breaches", value: tickets.sla_breaches, icon: Clock, color: tickets.sla_breaches > 0 ? "text-red-400" : "text-emerald-400", bg: tickets.sla_breaches > 0 ? "bg-red-500/10" : "bg-emerald-500/10", danger: tickets.sla_breaches > 0 },
          { label: "Backups Failed", value: backups.failed, total: backups.total, icon: HardDrive, color: backups.failed > 0 ? "text-red-400" : "text-emerald-400", bg: backups.failed > 0 ? "bg-red-500/10" : "bg-emerald-500/10", danger: backups.failed > 0 },
          { label: "Security Alerts", value: security.critical_alerts, total: security.alerts_24h, icon: Shield, color: security.critical_alerts > 0 ? "text-amber-400" : "text-emerald-400", bg: security.critical_alerts > 0 ? "bg-amber-500/10" : "bg-emerald-500/10", danger: security.critical_alerts > 0 },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={`mc-${i}`} className={s.danger ? "border-red-500/30" : ""} data-testid={`mc-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                    {s.total !== undefined && <p className="text-[9px] text-muted-foreground/60">of {s.total} total</p>}
                  </div>
                  <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Offline Devices */}
          {devices.offline > 0 && (
            <Card className="border-red-500/20" data-testid="offline-devices">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><WifiOff className="w-4 h-4 text-red-400" />Devices Offline ({devices.offline})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {devices.offline_list.map((d, i) => (
                    <div key={`off-${i}`} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-red-500/5">
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /><span className="font-medium">{d.name}</span></div>
                      <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{d.client_name}</span><Badge variant="outline" className="text-[9px]">{d.device_type}</Badge></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Critical/High Tickets */}
          {tickets.critical_high > 0 && (
            <Card className="border-amber-500/20" data-testid="critical-tickets">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" />Critical & High Tickets ({tickets.critical_high})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {tickets.critical_list.map((t, i) => (
                    <div key={`ct-${i}`} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-amber-500/5">
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-xs">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground">{t.client_name}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={`text-[9px] ${t.priority === "critical" ? "bg-red-500/15 text-red-400" : "bg-orange-500/15 text-orange-400"}`}>{t.priority}</Badge>
                        <span className="text-[10px] text-muted-foreground">{t.assigned_name || "Unassigned"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Overnight New Tickets */}
          {tickets.overnight_new > 0 && (
            <Card data-testid="overnight-tickets">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-blue-400" />New Overnight Tickets ({tickets.overnight_new})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {tickets.overnight_list.map((t, i) => (
                    <div key={`ov-${i}`} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-blue-500/5">
                      <div className="flex-1 min-w-0"><p className="truncate font-medium text-xs">{t.title}</p><p className="text-[10px] text-muted-foreground">{t.client_name}</p></div>
                      <Badge className={`text-[9px] ${t.priority === "critical" ? "bg-red-500/15 text-red-400" : t.priority === "high" ? "bg-orange-500/15 text-orange-400" : "bg-zinc-500/15 text-zinc-400"}`}>{t.priority}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Backup Failures */}
          {backups.failed > 0 && (
            <Card className="border-red-500/20" data-testid="failed-backups">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><HardDrive className="w-4 h-4 text-red-400" />Failed Backups ({backups.failed})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {backups.failed_list.map((b, i) => (
                    <div key={`fb-${i}`} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-red-500/5">
                      <div><span className="font-medium text-xs">{b.name}</span><p className="text-[10px] text-muted-foreground">{b.client_name}</p></div>
                      <Badge variant="outline" className="text-[9px]">{b.type}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Client Health RAG Board */}
          <Card data-testid="client-health">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" />Client Health Board</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[280px]">
                <div className="space-y-1.5">
                  {client_health.map((c, i) => {
                    const rag = RAG[c.status] || RAG.green;
                    return (
                      <div key={`ch-${i}`} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${rag.border} ${rag.bg}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${rag.dot}`} />
                          <span className="font-medium text-sm">{c.client_name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-muted-foreground"><Server className="w-3 h-3 inline mr-0.5" />{c.devices_total - c.devices_offline}/{c.devices_total}</span>
                          {c.devices_offline > 0 && <span className="text-red-400">{c.devices_offline} offline</span>}
                          {c.critical_tickets > 0 && <span className="text-amber-400">{c.critical_tickets} critical</span>}
                          {c.backups_failed > 0 && <span className="text-red-400">{c.backups_failed} backup fail</span>}
                          <span className="text-muted-foreground">{c.open_tickets} tickets</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Quick Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            <Card data-testid="unassigned-stat">
              <CardContent className="pt-3 pb-2">
                <p className={`text-xl font-black ${tickets.unassigned > 0 ? "text-purple-400" : "text-emerald-400"}`}>{tickets.unassigned}</p>
                <p className="text-[10px] text-muted-foreground">Unassigned Tickets</p>
              </CardContent>
            </Card>
            <Card data-testid="patches-stat">
              <CardContent className="pt-3 pb-2">
                <p className={`text-xl font-black ${patches_pending > 0 ? "text-amber-400" : "text-emerald-400"}`}>{patches_pending}</p>
                <p className="text-[10px] text-muted-foreground">Critical Patches</p>
              </CardContent>
            </Card>
            <Card data-testid="recurring-due-stat">
              <CardContent className="pt-3 pb-2">
                <p className={`text-xl font-black ${recurring_due.length > 0 ? "text-violet-400" : "text-zinc-400"}`}>{recurring_due.length}</p>
                <p className="text-[10px] text-muted-foreground">Invoices Due</p>
              </CardContent>
            </Card>
          </div>

          {/* Overdue Invoices */}
          {overdue_invoices.count > 0 && (
            <Card className="border-amber-500/20" data-testid="overdue-invoices">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-amber-400" />Overdue Invoices ({overdue_invoices.count} | ${overdue_invoices.total_amount?.toLocaleString()})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {overdue_invoices.list.map((inv, i) => (
                    <div key={`oi-${i}`} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-amber-500/5">
                      <div><span className="font-mono text-xs">{inv.invoice_number}</span><span className="text-xs text-muted-foreground ml-2">{inv.client_name}</span></div>
                      <span className="font-mono text-xs text-amber-400">${inv.amount_due?.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Phone System & Scheduled Tasks */}
          <Card data-testid="phone-status">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Phone className="w-4 h-4 text-cyan-400" />Phone System (Yeastar)</CardTitle></CardHeader>
            <CardContent>
              {phones.configured ? (
                <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-400" /><span className="text-sm">Yeastar PBX Connected</span></div>
              ) : (
                <div className="flex items-center gap-2"><XCircle className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Yeastar PBX not configured - <a href="/settings" className="text-cyan-400 underline">Setup in Settings</a></span></div>
              )}
            </CardContent>
          </Card>

          {/* Scheduled Tasks */}
          {scheduled_tasks.length > 0 && (
            <Card data-testid="scheduled-tasks">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4 text-violet-400" />Scheduled Tasks Today ({scheduled_tasks.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {scheduled_tasks.map((t, i) => (
                    <div key={`st-${i}`} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-violet-500/5">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground">{t.schedule_time}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* All Green Message */}
      {devices.offline === 0 && tickets.critical_high === 0 && backups.failed === 0 && security.critical_alerts === 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5" data-testid="all-clear">
          <CardContent className="py-6 flex items-center justify-center gap-3">
            <CheckCircle className="w-6 h-6 text-emerald-400" />
            <div><p className="font-bold text-emerald-400">All Systems Operational</p><p className="text-sm text-muted-foreground">No critical issues detected. Great start to the day!</p></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
