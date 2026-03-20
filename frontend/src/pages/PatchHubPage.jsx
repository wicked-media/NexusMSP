import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, RotateCcw, Play, Pause, ChevronRight, Search, Filter, Download, ArrowUpDown, Layers, Zap, TestTube, FileCode, Ban } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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
          <p className="text-muted-foreground text-sm">Unified patch management - OS, 3rd party apps, deployment rings, intelligence</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />Export Report</Button>
          <Button size="sm"><Play className="w-4 h-4 mr-1" />Run Patch Cycle</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-8 w-full">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="intelligence" data-testid="tab-intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="rings" data-testid="tab-rings">Rings</TabsTrigger>
          <TabsTrigger value="exclusions" data-testid="tab-exclusions">Exclusions</TabsTrigger>
          <TabsTrigger value="reboot" data-testid="tab-reboot">Reboots</TabsTrigger>
          <TabsTrigger value="rollback" data-testid="tab-rollback">Rollback</TabsTrigger>
          <TabsTrigger value="testing" data-testid="tab-testing">Testing</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
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
              <div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">App Compliance</div><Layers className="w-5 h-5 text-green-500" /></div>
              <div className="text-3xl font-bold mt-1">{app.compliance_pct || 0}%</div>
              <Progress value={app.compliance_pct || 0} className="mt-2 h-2" />
              <div className="text-xs text-muted-foreground mt-1">{app.current || 0}/{app.total_apps || 0} apps current</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">Pending Patches</div><Clock className="w-5 h-5 text-yellow-500" /></div>
              <div className="text-3xl font-bold mt-1">{os.total_pending_patches || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Across all devices</div>
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
                      {c.critical > 0 ? `${c.critical} crit` : c.needs_attention > 0 ? `${c.needs_attention} warn` : "OK"}
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
      </Tabs>
    </div>
  );
}
