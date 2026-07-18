import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, RotateCcw, Play, Pause, ChevronRight, Search, Filter, Download, ArrowUpDown, Layers, Zap, TestTube, FileCode, Ban, Terminal, Settings, Copy, Monitor, Server, Wifi, WifiOff, Cpu, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatDistanceToNow } from "date-fns";

export default function PatchHubPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [intelligence, setIntelligence] = useState(null);
  const [rings, setRings] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [rebootSchedules, setRebootSchedules] = useState([]);
  const [rollbacks, setRollbacks] = useState(null);
  const [testing, setTesting] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [compliance, setCompliance] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agentScript, setAgentScript] = useState(null);
  const [agentReports, setAgentReports] = useState(null);
  const [agentSettings, setAgentSettings] = useState({ api_url: "", agent_api_key: "", report_interval: 3600 });

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { fetchData(); }, [tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "dashboard" || !dashboard) {
        const [dRes, cRes] = await Promise.all([
          axios.get(`${API}/patch-hub/dashboard`, { headers }),
          axios.get(`${API}/patch-hub/compliance-by-client`, { headers }),
        ]);
        setDashboard(dRes.data);
        setCompliance(cRes.data);
      }
      if (tab === "intelligence") {
        const res = await axios.get(`${API}/patch-hub/intelligence`, { headers });
        setIntelligence(res.data);
      }
      if (tab === "rings") {
        const res = await axios.get(`${API}/patch-hub/rings`, { headers });
        setRings(res.data);
      }
      if (tab === "exclusions") {
        const res = await axios.get(`${API}/patch-hub/exclusions`, { headers });
        setExclusions(res.data);
      }
      if (tab === "reboot") {
        const res = await axios.get(`${API}/patch-hub/reboot-schedule`, { headers });
        setRebootSchedules(res.data);
      }
      if (tab === "rollback") {
        const res = await axios.get(`${API}/patch-hub/rollbacks`, { headers });
        setRollbacks(res.data);
      }
      if (tab === "testing") {
        const [tRes, sRes] = await Promise.all([
          axios.get(`${API}/patch-hub/testing`, { headers }),
          axios.get(`${API}/patch-hub/scripts`, { headers }),
        ]);
        setTesting(tRes.data);
        setScripts(sRes.data);
      }
      if (tab === "history") {
        const res = await axios.get(`${API}/patch-hub/history`, { headers });
        setHistory(res.data);
      }
      if (tab === "agent") {
        const [scriptRes, reportsRes] = await Promise.all([
          axios.get(`${API}/patch-hub/agent/download-script`, { headers }),
          axios.get(`${API}/patch-hub/agent/reports`, { headers }),
        ]);
        setAgentScript(scriptRes.data);
        setAgentReports(reportsRes.data);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const promoteRing = async (ringId) => {
    await axios.post(`${API}/patch-hub/rings/${ringId}/promote`, {}, { headers });
    fetchData();
  };

  if (loading && !dashboard) return <div className="p-6 text-muted-foreground">Loading Patch Hub...</div>;

  const os = dashboard?.os_summary || {};
  const app = dashboard?.app_summary || {};
  const stats7d = dashboard?.stats_7d || [];

  return (
    <div className="space-y-6" data-testid="patch-hub-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Patch Hub</h1>
          <p className="text-muted-foreground text-sm">Nexus Agent Windows Update posture and approved patch scheduling</p>
        </div>
        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">Agent-reported updates</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-9 w-full">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="intelligence" data-testid="tab-intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="rings" data-testid="tab-rings">Rings</TabsTrigger>
          <TabsTrigger value="exclusions" data-testid="tab-exclusions">Exclusions</TabsTrigger>
          <TabsTrigger value="reboot" data-testid="tab-reboot">Reboots</TabsTrigger>
          <TabsTrigger value="rollback" data-testid="tab-rollback">Rollback</TabsTrigger>
          <TabsTrigger value="testing" data-testid="tab-testing">Testing</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          <TabsTrigger value="agent" data-testid="tab-agent" className="gap-1"><Terminal className="w-3 h-3" />Agent</TabsTrigger>
        </TabsList>

        {/* ─── DASHBOARD TAB ─── */}
        <TabsContent value="dashboard" className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">OS Compliance</div><Shield className="w-5 h-5 text-blue-500" /></div>
              <div className="text-3xl font-bold mt-1">{os.compliance_pct || 0}%</div>
              <Progress value={os.compliance_pct || 0} className="mt-2 h-2" />
              <div className="text-xs text-muted-foreground mt-1">{os.compliant || 0}/{os.total_devices || 0} devices current</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">3rd-party apps</div><Layers className="w-5 h-5 text-muted-foreground" /></div>
              <div className="text-2xl font-bold mt-2 text-muted-foreground">Not assessed</div>
              <Progress value={0} className="mt-3 h-2" />
              <div className="text-xs text-muted-foreground mt-1">Connect a patch provider to assess applications</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">Pending Patches</div><Clock className="w-5 h-5 text-yellow-500" /></div>
              <div className="text-3xl font-bold mt-1">{os.total_pending_patches || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Across {os.total_devices || 0} assessed devices</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">Critical Devices</div><AlertTriangle className="w-5 h-5 text-red-500" /></div>
              <div className="text-3xl font-bold mt-1 text-red-500">{os.critical || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">{os.needs_attention || 0} need attention</div>
            </CardContent></Card>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">7-Day Patch Activity</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats7d}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--card-foreground))' }} />
                    <Bar dataKey="installed" fill="#22c55e" radius={[4, 4, 0, 0]} name="Installed" />
                    <Bar dataKey="failed" fill="#ef4444" radius={[4, 4, 0, 0]} name="Failed" />
                    <Bar dataKey="rolled_back" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Rolled Back" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Ring Status</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(dashboard?.rings || []).map(r => (
                    <div key={r.id} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color || '#3b82f6' }} />
                      <div className="flex-1">
                        <div className="flex justify-between text-sm"><span className="font-medium">{r.name}</span><span className="text-muted-foreground">{r.device_count} devices</span></div>
                        <div className="text-xs text-muted-foreground">{r.pending_patches} patches pending</div>
                      </div>
                    </div>
                  ))}
                  {(dashboard?.rings || []).length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No deployment rings configured. Schedule approved patches from a ticket or device.</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Client Compliance Table */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">Compliance by Client</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {compliance.map(c => (
                  <div key={c.client_name} className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50">
                    <div className="flex-1 font-medium text-sm">{c.client_name}</div>
                    <div className="w-32"><Progress value={c.compliance_pct} className="h-2" /></div>
                    <div className="w-16 text-right text-sm font-medium">{c.compliance_pct}%</div>
                    <Badge variant={c.critical > 0 ? "destructive" : c.needs_attention > 0 ? "secondary" : "default"} className="text-xs">
                      {c.unassessed > 0 ? `${c.unassessed} unassessed` : c.critical > 0 ? `${c.critical} crit` : c.needs_attention > 0 ? `${c.needs_attention} warn` : "OK"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── INTELLIGENCE TAB ─── */}
        <TabsContent value="intelligence" className="space-y-4">
          {intelligence && (
            <>
              <div className="grid grid-cols-5 gap-4">
                {[
                  ["Critical (9+)", intelligence.summary.critical_cvss, "text-red-500"],
                  ["High (7-8.9)", intelligence.summary.high_cvss, "text-orange-500"],
                  ["Medium (4-6.9)", intelligence.summary.medium_cvss, "text-yellow-500"],
                  ["Low (<4)", intelligence.summary.low_cvss, "text-green-500"],
                  ["AI Paused", intelligence.summary.auto_paused, "text-purple-500"],
                ].map(([label, val, color]) => (
                  <Card key={label}><CardContent className="pt-4 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{val}</div>
                    <div className="text-xs text-muted-foreground mt-1">{label}</div>
                  </CardContent></Card>
                ))}
              </div>
              <Card><CardContent className="pt-4">
                <div className="space-y-2">
                  {intelligence.patches.map(p => (
                    <div key={p.id} className={`flex items-center gap-4 p-3 rounded-lg border ${p.auto_paused ? 'border-purple-500/50 bg-purple-500/5' : 'border-border'}`}>
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm ${p.cvss_score >= 9 ? 'bg-red-500/20 text-red-500' : p.cvss_score >= 7 ? 'bg-orange-500/20 text-orange-500' : p.cvss_score >= 4 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}`}>
                        {p.cvss_score}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{p.kb_id}</span>
                          {p.auto_paused && <Badge variant="secondary" className="text-xs bg-purple-500/20 text-purple-400"><Pause className="w-3 h-3 mr-1" />AI Paused</Badge>}
                          <Badge variant="outline" className="text-xs">{p.stability}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground truncate">{p.title}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="text-muted-foreground">{p.affected_devices} devices</div>
                        <div className="text-xs text-muted-foreground">{p.cve}</div>
                      </div>
                      <Badge variant={p.recommended_action === "block" ? "destructive" : p.recommended_action === "deploy" ? "default" : "secondary"} className="text-xs">{p.recommended_action}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent></Card>
            </>
          )}
        </TabsContent>

        {/* ─── RINGS TAB ─── */}
        <TabsContent value="rings" className="space-y-4">
          <div className="flex items-center gap-4 mb-2">
            <div className="flex-1 flex items-center gap-2">
              {rings.map((r, i) => (
                <div key={r.id} className="flex items-center">
                  <div className="flex items-center gap-1 px-3 py-1.5 rounded-full border text-sm" style={{ borderColor: r.color }}>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="font-medium">{r.name}</span>
                  </div>
                  {i < rings.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground mx-1" />}
                </div>
              ))}
            </div>
          </div>
          {rings.map(r => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className="w-4 h-full rounded" style={{ backgroundColor: r.color }} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{r.name} <span className="text-muted-foreground font-normal text-sm">({r.device_count} devices)</span></h3>
                        <p className="text-sm text-muted-foreground">{r.description}</p>
                      </div>
                      <div className="flex gap-2">
                        {r.auto_promote ? <Badge className="text-xs">Auto-Promote after {r.promote_after_hours}h</Badge> : <Badge variant="secondary" className="text-xs">Manual Approval</Badge>}
                        <Button size="sm" variant="outline" onClick={() => promoteRing(r.id)}><ChevronRight className="w-4 h-4 mr-1" />Promote</Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 mt-3 text-sm">
                      <div><span className="text-muted-foreground">Delay:</span> {r.delay_hours}h</div>
                      <div><span className="text-muted-foreground">Success Threshold:</span> {r.success_threshold_pct}%</div>
                      <div><span className="text-muted-foreground">Pre-Script:</span> {r.pre_script || "None"}</div>
                      <div><span className="text-muted-foreground">Post-Script:</span> {r.post_script || "None"}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ─── EXCLUSIONS TAB ─── */}
        <TabsContent value="exclusions" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Manage patches and apps excluded from automatic deployment</p>
            <Button size="sm"><Ban className="w-4 h-4 mr-1" />Add Exclusion</Button>
          </div>
          {exclusions.filter(e => e.active).map(e => (
            <Card key={e.id}><CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">{e.kb_id || e.app_name}</Badge>
                    <Badge variant="outline" className="text-xs">{e.scope}</Badge>
                    {e.client_name && <span className="text-xs text-muted-foreground">{e.client_name}</span>}
                  </div>
                  <p className="text-sm mt-1">{e.reason}</p>
                  <div className="text-xs text-muted-foreground mt-1">Added by {e.created_by} {e.expires_at ? `| Expires: ${new Date(e.expires_at).toLocaleDateString()}` : "| No expiry"}</div>
                </div>
                <Button size="sm" variant="ghost" className="text-red-500">Remove</Button>
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>

        {/* ─── REBOOT TAB ─── */}
        <TabsContent value="reboot" className="space-y-4">
          {rebootSchedules.map(s => (
            <Card key={s.id}><CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{s.client_name}</h3>
                  <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                    <span>Every {s.day_of_week} at {s.time_utc} UTC</span>
                    <span>Max Deferral: {s.max_deferral_hours}h x{s.deferral_count_max}</span>
                    <span>Force after: {s.force_reboot_after_hours}h</span>
                    <span>Notify {s.notify_user_minutes_before}min before</span>
                  </div>
                </div>
                <div className="text-right">
                  <Badge>{s.devices_pending_reboot} pending reboots</Badge>
                  <div className="text-xs text-muted-foreground mt-1">{s.schedule_type.replace("_", " ")}</div>
                </div>
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>

        {/* ─── ROLLBACK TAB ─── */}
        <TabsContent value="rollback" className="space-y-4">
          {rollbacks && (
            <>
              <Card><CardHeader className="pb-2"><CardTitle className="text-base">Rollback History</CardTitle></CardHeader>
                <CardContent>
                  {rollbacks.rollback_history.map(r => (
                    <div key={r.id} className="flex items-center gap-4 p-3 border-b last:border-0">
                      <RotateCcw className="w-5 h-5 text-orange-500" />
                      <div className="flex-1">
                        <span className="font-medium text-sm">{r.kb_id}</span> - {r.title}
                        <div className="text-xs text-muted-foreground">{r.reason}</div>
                      </div>
                      <div className="text-sm">{r.device_count} devices</div>
                      <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-base">Available Rollbacks</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {rollbacks.available_rollbacks.slice(0, 10).map(r => (
                      <div key={r.id} className="flex items-center gap-4 p-2 rounded hover:bg-muted/50">
                        <div className="flex-1 text-sm"><span className="font-medium">{r.kb_id}</span> on {r.device_name} <span className="text-muted-foreground">({r.client_name})</span></div>
                        <Button size="sm" variant="outline"><RotateCcw className="w-3 h-3 mr-1" />Rollback</Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── TESTING TAB ─── */}
        <TabsContent value="testing" className="space-y-4">
          {testing && (
            <>
              <div className="grid grid-cols-4 gap-4">
                {[["Tested", testing.summary.total_tested, "text-blue-500"], ["Passed", testing.summary.passed, "text-green-500"], ["Failed", testing.summary.failed, "text-red-500"], ["Warnings", testing.summary.warnings, "text-yellow-500"]].map(([l, v, c]) => (
                  <Card key={l}><CardContent className="pt-4 text-center"><div className={`text-2xl font-bold ${c}`}>{v}</div><div className="text-xs text-muted-foreground">{l}</div></CardContent></Card>
                ))}
              </div>
              <Card><CardHeader className="pb-2"><CardTitle className="text-base">Test Results</CardTitle></CardHeader>
                <CardContent><div className="space-y-2">
                  {testing.results.map(r => (
                    <div key={r.id} className="flex items-center gap-4 p-2 rounded hover:bg-muted/50">
                      {r.result === "pass" ? <CheckCircle className="w-5 h-5 text-green-500" /> : r.result === "fail" ? <XCircle className="w-5 h-5 text-red-500" /> : <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                      <div className="flex-1"><div className="text-sm font-medium">{r.kb_id} on {r.test_vm}</div><div className="text-xs text-muted-foreground">{r.os_version} | {r.install_time_seconds}s | {r.notes || "No issues"}</div></div>
                      <Badge variant={r.result === "pass" ? "default" : r.result === "fail" ? "destructive" : "secondary"}>{r.result}</Badge>
                    </div>
                  ))}
                </div></CardContent>
              </Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileCode className="w-4 h-4" />Pre/Post Scripts</CardTitle></CardHeader>
                <CardContent><div className="space-y-3">
                  {scripts.map(s => (
                    <div key={s.id} className="p-3 rounded-lg border">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={s.type === "pre" ? "secondary" : "default"} className="text-xs">{s.type}-deploy</Badge>
                        <span className="font-medium text-sm">{s.name}</span>
                        <span className="text-xs text-muted-foreground">Scope: {s.scope}</span>
                      </div>
                      <pre className="bg-background/50 p-2 rounded text-xs font-mono overflow-x-auto max-h-24">{s.content}</pre>
                    </div>
                  ))}
                </div></CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── HISTORY TAB ─── */}
        <TabsContent value="history" className="space-y-4">
          <Card><CardContent className="pt-4">
            <div className="space-y-1">
              {history.slice(0, 30).map(h => (
                <div key={h.id} className="flex items-center gap-4 p-2 rounded hover:bg-muted/50 text-sm">
                  {h.status === "success" ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> : h.status === "failed" ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> : h.status === "rolled_back" ? <RotateCcw className="w-4 h-4 text-orange-500 flex-shrink-0" /> : <Clock className="w-4 h-4 text-yellow-500 flex-shrink-0" />}
                  <span className="font-mono w-24 flex-shrink-0">{h.kb_id}</span>
                  <span className="flex-1 truncate">{h.device_name} <span className="text-muted-foreground">({h.client_name})</span></span>
                  <Badge variant="outline" className="text-xs">{h.ring}</Badge>
                  <Badge variant={h.status === "success" ? "default" : h.status === "failed" ? "destructive" : "secondary"} className="text-xs w-24 justify-center">{h.status}</Badge>
                  <span className="text-xs text-muted-foreground w-20">{h.duration_seconds}s</span>
                  <span className="text-xs text-muted-foreground w-32">{new Date(h.timestamp).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* ─── AGENT TAB ─── */}
        <TabsContent value="agent" className="space-y-6" data-testid="agent-tab-content">
          {/* Agent Overview */}
          <div className="grid grid-cols-4 gap-4">
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Reporting Devices</span><Monitor className="w-5 h-5 text-blue-500" /></div>
              <div className="text-3xl font-bold mt-1">{agentReports?.total_reporting || 0}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Healthy</span><CheckCircle className="w-5 h-5 text-green-500" /></div>
              <div className="text-3xl font-bold mt-1 text-green-500">{agentReports?.healthy || 0}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Needs Attention</span><AlertTriangle className="w-5 h-5 text-amber-500" /></div>
              <div className="text-3xl font-bold mt-1 text-amber-500">{agentReports?.needs_attention || 0}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Critical</span><XCircle className="w-5 h-5 text-red-500" /></div>
              <div className="text-3xl font-bold mt-1 text-red-500">{agentReports?.critical || 0}</div>
            </CardContent></Card>
          </div>

          {/* Deploy Agent */}
          <Card className="border-blue-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Terminal className="w-5 h-5 text-blue-500" />Deploy Patch Agent</CardTitle>
              <p className="text-sm text-muted-foreground">Download and deploy the NexusOps Patch Agent alongside RustDesk on client devices. The agent runs as a background service and reports Windows Update status back to this dashboard.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {agentScript && (
                <>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-xs">v{agentScript.version}</Badge>
                    <Badge variant="outline" className="text-xs">PowerShell</Badge>
                    <Badge variant="outline" className="text-xs">Windows</Badge>
                  </div>

                  {/* Quick Deploy Command */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">One-Line Deploy Command (run on client as Admin)</Label>
                    <div className="relative">
                      <pre className="bg-zinc-900 text-emerald-400 text-xs p-3 pr-10 rounded-lg overflow-x-auto font-mono">{agentScript.deploy_command}</pre>
                      <Button variant="ghost" size="sm" className="absolute top-1 right-1 h-7 w-7 p-0" onClick={() => { navigator.clipboard.writeText(agentScript.deploy_command); toast.success("Copied to clipboard"); }} data-testid="copy-deploy-cmd"><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Deployment Steps</Label>
                    <div className="space-y-1.5">
                      {agentScript.instructions.map((step, i) => (
                        <div key={`k-${i}`} className="flex items-start gap-2 text-sm">
                          <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">{i + 1}</div>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Full Script Preview */}
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium flex items-center gap-2 hover:text-primary">
                      <FileCode className="w-4 h-4" />View Full Agent Script
                      <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                    </summary>
                    <div className="mt-2 relative">
                      <pre className="bg-zinc-900 text-zinc-300 text-[11px] p-4 rounded-lg overflow-auto max-h-[400px] font-mono leading-relaxed">{agentScript.script}</pre>
                      <Button variant="outline" size="sm" className="absolute top-2 right-2 h-7 text-xs" onClick={() => {
                        const blob = new Blob([agentScript.script], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = agentScript.filename;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success("Script downloaded");
                      }} data-testid="download-agent-script"><Download className="w-3 h-3 mr-1" />Download .ps1</Button>
                    </div>
                  </details>
                </>
              )}
            </CardContent>
          </Card>

          {/* Reporting Devices Table */}
          {(agentReports?.reports || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Server className="w-5 h-5 text-emerald-500" />Reporting Devices ({agentReports.reports.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {agentReports.reports.map(r => (
                    <div key={r.id || r.hostname} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30 transition-colors" data-testid={`agent-report-${r.hostname}`}>
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${r.critical_updates > 0 ? "bg-red-500/20" : r.pending_updates_count > 0 ? "bg-amber-500/20" : "bg-emerald-500/20"}`}>
                        <Monitor className={`w-5 h-5 ${r.critical_updates > 0 ? "text-red-400" : r.pending_updates_count > 0 ? "text-amber-400" : "text-emerald-400"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{r.hostname}</p>
                        <div className="flex gap-3 text-xs text-muted-foreground">
                          <span>{r.system_info?.os_name || "Unknown OS"}</span>
                          <span>{r.system_info?.os_version}</span>
                          {r.system_info?.uptime_hours && <span>Up {Math.round(r.system_info.uptime_hours)}h</span>}
                        </div>
                      </div>
                      <div className="text-center">
                        <p className={`text-lg font-bold ${r.pending_updates_count === 0 ? "text-emerald-500" : r.critical_updates > 0 ? "text-red-500" : "text-amber-500"}`}>{r.pending_updates_count}</p>
                        <p className="text-[9px] text-muted-foreground">pending</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-red-500">{r.critical_updates || 0}</p>
                        <p className="text-[9px] text-muted-foreground">critical</p>
                      </div>
                      <div className="text-center">
                        {r.defender_status?.antivirus_enabled ? (
                          <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30"><Shield className="w-3 h-3 mr-1" />Protected</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Unprotected</Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <Badge variant="secondary" className="text-[10px]">v{r.agent_version}</Badge>
                        {r.system_info?.pending_reboot && <Badge variant="destructive" className="text-[10px] ml-1">Reboot</Badge>}
                      </div>
                      <span className="text-[10px] text-muted-foreground w-20 text-right">{r.reported_at ? formatDistanceToNow(new Date(r.reported_at), { addSuffix: true }) : "Never"}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No Reports Yet */}
          {(!agentReports?.reports || agentReports.reports.length === 0) && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Monitor className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-lg font-medium text-muted-foreground">No Devices Reporting Yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1 max-w-md mx-auto">Deploy the NexusOps Patch Agent to client devices using the script above. Devices will start reporting within minutes of deployment.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
