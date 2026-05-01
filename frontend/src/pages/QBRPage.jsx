import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  FileBarChart, Sparkles, Loader2, Save, Download, ListChecks, AlertTriangle,
  TrendingUp, Server, Shield, DollarSign, Target, Award,
} from "lucide-react";

const SLA_TONE = {
  excellent: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  on_track: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  at_risk: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  breach: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

function quarterOptions() {
  const now = new Date();
  const opts = [];
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  q -= 1; // last completed
  if (q < 1) { q = 4; y -= 1; }
  for (let i = 0; i < 6; i++) {
    opts.push(`${y}-Q${q}`);
    q -= 1; if (q < 1) { q = 4; y -= 1; }
  }
  return opts;
}

export default function QBRPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [quarter, setQuarter] = useState(quarterOptions()[0]);
  const [qbr, setQbr] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedQbr, setSavedQbr] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    axios.get(`${API}/clients`, { headers })
      .then((r) => { setClients(r.data || []); if (r.data?.[0]?.id) setClientId(r.data[0].id); })
      .catch(() => toast.error("Failed to load clients"));
  }, [headers]);

  const loadHistory = useCallback(async () => {
    if (!clientId) return;
    try {
      const r = await axios.get(`${API}/qbr/${clientId}/list`, { headers });
      setHistory(r.data || []);
    } catch { setHistory([]); }
  }, [clientId, headers]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const generate = async () => {
    if (!clientId) { toast.error("Pick a client"); return; }
    setGenerating(true); setQbr(null); setSavedQbr(null);
    try {
      const r = await axios.get(`${API}/qbr/${clientId}?quarter=${quarter}`, { headers });
      setQbr(r.data);
      toast.success("QBR drafted");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setGenerating(false); }
  };

  const save = async () => {
    if (!qbr) return;
    setSaving(true);
    try {
      const r = await axios.post(`${API}/qbr/${qbr.client_id}/save`, {
        quarter: qbr.quarter, sections: qbr.sections, stats: qbr.stats,
      }, { headers });
      setSavedQbr(r.data);
      toast.success("QBR saved");
      loadHistory();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const downloadPdf = (qbrId) => {
    const url = `${API}/qbrs/${qbrId}/pdf?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  };

  const updateSection = (key, val) => setQbr((q) => ({ ...q, sections: { ...q.sections, [key]: val } }));

  const stats = qbr?.stats || {};

  return (
    <div className="p-6 space-y-5" data-testid="qbr-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <FileBarChart className="w-7 h-7 text-emerald-500" />
            Quarterly Business Reviews
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-drafted client reviews with cross-client pattern intelligence and one-click branded PDF export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-9 text-xs w-56" data-testid="qbr-client-select"><SelectValue placeholder="Pick a client" /></SelectTrigger>
            <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="h-9 text-xs w-32" data-testid="qbr-quarter-select"><SelectValue /></SelectTrigger>
            <SelectContent>{quarterOptions().map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
          </Select>
          <Button
            onClick={generate}
            disabled={!clientId || generating}
            variant="outline"
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            data-testid="qbr-generate-btn"
          >
            {generating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            {generating ? "Drafting…" : "Generate QBR"}
          </Button>
        </div>
      </div>

      {!qbr && !generating && (
        <Card className="border-dashed border-emerald-500/20">
          <CardContent className="p-12 text-center text-sm text-muted-foreground space-y-3">
            <FileBarChart className="w-10 h-10 mx-auto opacity-40 text-emerald-400" />
            <div>Pick a client and quarter, then hit <strong>Generate QBR</strong>. Claude will draft a 6-section review including cross-client pattern intelligence.</div>
            {history.length > 0 && (
              <div className="pt-4 border-t border-zinc-800 max-w-md mx-auto">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Recent QBRs for this client</div>
                <div className="space-y-1">
                  {history.slice(0, 5).map((h) => (
                    <div key={h.id} className="flex items-center justify-between bg-muted/30 rounded px-3 py-1.5 text-xs">
                      <span>{h.quarter} · {h.saved_by} · {(h.saved_at || "").slice(0, 10)}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => downloadPdf(h.id)} data-testid={`qbr-history-pdf-${h.id}`}>
                        <Download className="w-3 h-3 mr-1" />PDF
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {qbr && (
        <div className="space-y-4" data-testid="qbr-draft">
          {/* Stats strip */}
          <div className="grid grid-cols-5 gap-3">
            <KpiCard icon={<ListChecks className="w-4 h-4" />} label="Tickets" value={stats.tix_total || 0} accent="sky" />
            <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Critical" value={stats.by_priority?.critical || 0} accent="rose" />
            <KpiCard icon={<Server className="w-4 h-4" />} label="Devices Online" value={`${stats.devices?.online || 0}/${stats.devices?.total || 0}`} accent="emerald" />
            <KpiCard icon={<Shield className="w-4 h-4" />} label="SLA breaches" value={stats.sla_breaches || 0} accent="amber" />
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Spend" value={`$${(stats.spend || 0).toLocaleString()}`} accent="violet" />
          </div>

          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="p-5 space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <Award className="w-3 h-3" /> Executive Summary
              </div>
              <Textarea
                rows={4}
                className="text-sm bg-transparent border-emerald-500/20"
                value={qbr.sections?.executive_summary || ""}
                onChange={(e) => updateSection("executive_summary", e.target.value)}
                data-testid="qbr-section-executive"
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <SectionCard
              icon={<Award className="w-3 h-3" />} title="Key Wins" tone="emerald"
              items={qbr.sections?.key_wins} onChange={(v) => updateSection("key_wins", v)}
              testid="qbr-section-wins"
            />
            <SectionCard
              icon={<Target className="w-3 h-3" />} title="Focus for Next Quarter" tone="sky"
              items={qbr.sections?.next_quarter_focus} onChange={(v) => updateSection("next_quarter_focus", v)}
              testid="qbr-section-focus"
            />
          </div>

          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <ListChecks className="w-3 h-3" /> Incident Breakdown
                {qbr.sections?.incident_breakdown?.sla_assessment && (
                  <Badge variant="outline" className={SLA_TONE[qbr.sections.incident_breakdown.sla_assessment] || ""}>
                    SLA: {qbr.sections.incident_breakdown.sla_assessment}
                  </Badge>
                )}
              </div>
              <Textarea
                rows={3} className="text-sm"
                value={typeof qbr.sections?.incident_breakdown === "string" ? qbr.sections.incident_breakdown : qbr.sections?.incident_breakdown?.paragraph || ""}
                onChange={(e) => {
                  if (typeof qbr.sections?.incident_breakdown === "string") updateSection("incident_breakdown", e.target.value);
                  else updateSection("incident_breakdown", { ...qbr.sections.incident_breakdown, paragraph: e.target.value });
                }}
                data-testid="qbr-section-incidents"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Server className="w-3 h-3" /> Infrastructure Health
              </div>
              <Textarea rows={3} className="text-sm" value={qbr.sections?.infrastructure_health || ""} onChange={(e) => updateSection("infrastructure_health", e.target.value)} data-testid="qbr-section-infra" />
            </CardContent>
          </Card>

          <Card className="border-amber-500/20">
            <CardContent className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> Risks & Recommendations
              </div>
              <div className="space-y-2">
                {(qbr.sections?.risks_and_recommendations || []).map((rr, i) => (
                  <div key={i} className="bg-amber-500/5 border border-amber-500/15 rounded-md p-3 text-xs space-y-1" data-testid={`qbr-risk-${i}`}>
                    <Input
                      value={rr.area || ""}
                      onChange={(e) => {
                        const arr = [...qbr.sections.risks_and_recommendations];
                        arr[i] = { ...rr, area: e.target.value };
                        updateSection("risks_and_recommendations", arr);
                      }}
                      placeholder="Area" className="h-7 text-xs font-medium"
                    />
                    <Label className="text-[9px] text-muted-foreground">Risk</Label>
                    <Textarea
                      rows={2}
                      value={rr.risk || ""}
                      onChange={(e) => {
                        const arr = [...qbr.sections.risks_and_recommendations];
                        arr[i] = { ...rr, risk: e.target.value };
                        updateSection("risks_and_recommendations", arr);
                      }}
                      className="text-xs"
                    />
                    <Label className="text-[9px] text-muted-foreground">Recommendation</Label>
                    <Textarea
                      rows={2}
                      value={rr.recommendation || ""}
                      onChange={(e) => {
                        const arr = [...qbr.sections.risks_and_recommendations];
                        arr[i] = { ...rr, recommendation: e.target.value };
                        updateSection("risks_and_recommendations", arr);
                      }}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-violet-500/20 bg-violet-500/5">
            <CardContent className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-violet-400 flex items-center gap-2">
                <TrendingUp className="w-3 h-3" /> MSP Intelligence — Cross-client patterns
              </div>
              <Textarea rows={3} className="text-sm bg-transparent border-violet-500/20" value={qbr.sections?.msp_intelligence || ""} onChange={(e) => updateSection("msp_intelligence", e.target.value)} data-testid="qbr-section-intelligence" />
              {(stats.pattern_hits || []).length > 0 && (
                <div className="pt-2 space-y-1">
                  {(stats.pattern_hits || []).map((p, i) => (
                    <div key={i} className="text-[11px] text-violet-300 bg-violet-500/10 rounded px-2 py-1 flex items-center justify-between">
                      <span>· {p.name}: <strong>{p.client_tickets}</strong> tix here · also affecting {p.msp_clients} other clients ({p.msp_tickets} total)</span>
                      <Link to={`/blueprints?pattern=${p.tokens.join("_")}&t=${p.tokens.join(",")}`} className="text-violet-400 hover:underline">Draft Blueprint →</Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2 sticky bottom-4 bg-background/80 backdrop-blur p-3 rounded-md border border-zinc-800">
            <span className="text-[10px] text-muted-foreground mr-auto">
              {qbr.ai_model} · generated {new Date(qbr.generated_at).toLocaleString()}
            </span>
            <Button onClick={save} disabled={saving} variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="qbr-save-btn">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Save
            </Button>
            {savedQbr && (
              <Button onClick={() => downloadPdf(savedQbr.id)} variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="qbr-pdf-btn">
                <Download className="w-4 h-4 mr-1" />Download PDF
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, accent }) {
  const col = { rose: "text-rose-400", amber: "text-amber-400", sky: "text-sky-400", emerald: "text-emerald-400", violet: "text-violet-400" }[accent] || "text-zinc-400";
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${col}`}>{icon}{label}</div>
        <div className="text-2xl font-light mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function SectionCard({ icon, title, tone, items, onChange, testid }) {
  const ringTone = { emerald: "border-emerald-500/20", sky: "border-sky-500/20", amber: "border-amber-500/20" }[tone] || "border-zinc-800";
  const accentTone = { emerald: "text-emerald-400", sky: "text-sky-400", amber: "text-amber-400" }[tone] || "text-muted-foreground";
  const update = (i, val) => { const arr = [...(items || [])]; arr[i] = val; onChange(arr); };
  const remove = (i) => onChange((items || []).filter((_, idx) => idx !== i));
  const add = () => onChange([...(items || []), ""]);
  return (
    <Card className={ringTone}>
      <CardContent className="p-4 space-y-2" data-testid={testid}>
        <div className={`text-[10px] uppercase tracking-widest flex items-center gap-2 ${accentTone}`}>
          {icon} {title}
        </div>
        <div className="space-y-1">
          {(items || []).map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`text-xs ${accentTone}`}>•</span>
              <Input value={it} onChange={(e) => update(i, e.target.value)} className="h-8 text-sm flex-1" />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => remove(i)}>×</Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={add}>+ Add bullet</Button>
      </CardContent>
    </Card>
  );
}
