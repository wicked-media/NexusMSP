import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, AlertTriangle, TrendingUp, Heart, DollarSign,
  Users, Shield, Target, ArrowUpRight, CircleDashed, PlugZap, ChevronDown
} from "lucide-react";
import { MetricStrip, MetricTile } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { healthBand } from "@/lib/clientHealthBands";

const hasScore = (score) => typeof score === "number" && Number.isFinite(score);

const SCORE_TONES = {
  thriving: { text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  healthy: { text: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/30" },
  needs_attention: { text: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  at_risk: { text: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  critical: { text: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/30" },
};

const scoreColor = (score) => {
  const band = healthBand(score);
  return band ? SCORE_TONES[band.key] : { text: "text-slate-300", bg: "bg-slate-500/10", border: "border-slate-500/30" };
};

const EVIDENCE_DIMENSIONS = ["ticket", "device", "payment", "backup", "security", "m365", "network"];
const EVIDENCE_LABELS = {
  ticket: "tickets",
  device: "devices",
  payment: "payments",
  backup: "backups",
  security: "security",
  m365: "Microsoft 365",
  network: "network",
};

const EVIDENCE_CONNECTIONS = {
  ticket: { label: "Open ticket workspace", destination: "Tickets", path: (id) => `/clients?client=${encodeURIComponent(id)}&view=tickets` },
  device: { label: "Enrol a Nexus Agent", destination: "Managed assets", path: (id) => `/nexus-agent?client=${encodeURIComponent(id)}&installer=1` },
  payment: { label: "Open client billing", destination: "Billing", path: (id) => `/clients?client=${encodeURIComponent(id)}&view=billing` },
  backup: { label: "Connect backup evidence", destination: "Backup Center", path: () => "/backup-center" },
  security: { label: "Connect security evidence", destination: "Security", path: () => "/security-dashboard" },
  m365: { label: "Connect Microsoft 365", destination: "Control Plane", path: () => "/control-plane?module=microsoft365&view=connections" },
  network: { label: "Connect network evidence", destination: "UniFi", path: () => "/unifi" },
};

export function evidenceConnectionFor(key, clientId) {
  return EVIDENCE_CONNECTIONS[key]?.path(clientId) ?? null;
}

function ConnectEvidenceAction({ client, onStart }) {
  const missing = Array.isArray(client.missing_sources)
    ? client.missing_sources
    : EVIDENCE_DIMENSIONS.filter((key) => !(client.assessed_dimensions || []).includes(key));
  const choices = missing.map((key) => ({ key, ...EVIDENCE_CONNECTIONS[key] })).filter((choice) => choice.label);

  if (!choices.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-8 gap-1.5 border-sky-400/25 bg-sky-400/[0.06] text-[11px] text-sky-200 hover:bg-sky-400/[0.12]"
          data-testid={`connect-evidence-${client.client_id}`}
        >
          <PlugZap className="h-3.5 w-3.5" />
          Connect evidence
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72" data-testid="connect-evidence-menu">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Missing evidence sources
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.key}
            onSelect={() => onStart(choice.key, choice.path(client.client_id), client.client_id)}
            className="gap-2 text-xs"
            data-testid={`connect-evidence-${choice.key}`}
          >
            <span className="flex-1">{choice.label}</span>
            <span className="text-[10px] text-muted-foreground">{choice.destination}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EvidenceCoverage({ client, dense = false }) {
  const assessed = Array.isArray(client.assessed_dimensions)
    ? client.assessed_dimensions
    : EVIDENCE_DIMENSIONS.filter((key) => !(client.missing_sources || []).includes(key));
  const missing = Array.isArray(client.missing_sources)
    ? client.missing_sources
    : EVIDENCE_DIMENSIONS.filter((key) => !assessed.includes(key));
  const coverage = typeof client.evidence_coverage_pct === "number"
    ? Math.max(0, Math.min(100, client.evidence_coverage_pct))
    : Math.round((assessed.length / EVIDENCE_DIMENSIONS.length) * 100);
  const missingLabel = missing.map((key) => EVIDENCE_LABELS[key] || key.replaceAll("_", " ")).join(", ");

  if (dense) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]" data-testid={`evidence-coverage-${client.client_id}`}>
        <span className="text-muted-foreground">Evidence {coverage}%</span>
        <span className={missing.length ? "text-amber-300/90" : "text-emerald-300/90"}>
          {missing.length ? `Missing: ${missingLabel}` : "All sources recorded"}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5" data-testid={`evidence-coverage-${client.client_id}`}>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-muted-foreground">Evidence coverage</span>
        <span className="font-mono text-slate-300">{coverage}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-sky-400/80" style={{ width: `${coverage}%` }} />
      </div>
      <p className={`text-[10px] ${missing.length ? "text-amber-300/90" : "text-emerald-300/90"}`}>
        {missing.length ? `Missing: ${missingLabel}` : "All evidence dimensions recorded"}
      </p>
    </div>
  );
}

export default function HealthRadarPage({ embedded = false }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/health-radar/dashboard`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to fetch radar data"); }
    finally { setLoading(false); }
  };

  const recordEvidenceStart = async (source, path, clientId) => {
    try {
      await axios.post(`${API}/health-radar/evidence-actions`, { client_id: clientId, source }, { headers });
    } catch {
      toast.error("The evidence action was not recorded", { description: "The source workspace will still open." });
    }
    navigate(path);
  };

  useEffect(() => {
    if (!embedded) {
      navigate("/client-insights?tab=portfolio-radar", { replace: true });
      return;
    }
    fetchData();
  }, [embedded, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!embedded) return null;
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5 p-6" data-testid="health-radar-page">
      {!embedded ? <OperationalPageHeader eyebrow="Client intelligence · relationship health" title="Client Health Radar" description="Prioritise retention risk and evidence-backed revenue opportunity across the client portfolio." icon={Heart} tone="rose" signal={data?.summary?.at_risk_count > 0 ? "attention" : "ready"} actions={<Button size="sm" variant="outline" onClick={fetchData}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh radar</Button>} /> : <div className="flex justify-end"><Button size="sm" variant="outline" onClick={fetchData}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh radar</Button></div>}

      {data && (
        <>
          <MetricStrip columns={5}>
            <MetricTile label="Clients monitored" value={data.summary.total_clients} accent="indigo" icon={<Users className="w-2.5 h-2.5 text-indigo-400" />} />
            <MetricTile label="Require attention" value={data.summary.at_risk_count} accent="rose" icon={<AlertTriangle className="w-2.5 h-2.5 text-rose-400" />} />
            <MetricTile label="Healthy clients" value={data.summary.healthy_count} accent="emerald" icon={<Heart className="w-2.5 h-2.5 text-emerald-400" />} />
            <MetricTile label="Not assessed" value={data.summary.not_assessed_count ?? 0} accent="zinc" icon={<CircleDashed className="w-2.5 h-2.5 text-slate-400" />} />
            <MetricTile label="Growth potential" value={hasScore(data.summary.total_potential_mrr) ? `$${data.summary.total_potential_mrr.toLocaleString()}` : "$0"} accent="sky" icon={<TrendingUp className="w-2.5 h-2.5 text-sky-400" />} />
          </MetricStrip>

          <p className="text-[11px] text-muted-foreground">{data.summary.evidence_policy || "A client is scored only when at least two independent evidence dimensions are recorded."} {data.summary.not_assessed_count > 0 && `${data.summary.not_assessed_count} account(s) currently have no score.`}</p>

          <Tabs defaultValue="at-risk" className="space-y-4">
            <TabsList className="w-full max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-1 h-auto rounded-lg border border-border bg-card p-1">
              <TabsTrigger value="at-risk" className="text-[11px] sm:text-xs px-1.5 whitespace-nowrap"><AlertTriangle className="w-3 h-3 mr-1" />Needs attention ({data.at_risk_clients.length})</TabsTrigger>
              <TabsTrigger value="opportunities" className="text-[11px] sm:text-xs px-1.5 whitespace-nowrap"><TrendingUp className="w-3 h-3 mr-1" />Opportunities ({data.upsell_opportunities.length})</TabsTrigger>
              <TabsTrigger value="healthy" className="text-[11px] sm:text-xs px-1.5 whitespace-nowrap"><Heart className="w-3 h-3 mr-1" />Healthy ({data.healthy_clients.length})</TabsTrigger>
              <TabsTrigger value="unassessed" className="text-[11px] sm:text-xs px-1.5 whitespace-nowrap"><CircleDashed className="w-3 h-3 mr-1" />Not assessed ({data.unassessed_clients?.length ?? 0})</TabsTrigger>
            </TabsList>

            <TabsContent value="at-risk">
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {data.at_risk_clients.map(client => {
                    const sc = scoreColor(client.health_score);
                    return (
                      <Card key={client.client_id} className={`${sc.border} border hover:bg-muted/20 transition-all`} data-testid={`risk-client-${client.client_id}`}>
                        <CardContent className="py-4">
                          <div className="flex items-start gap-4">
                            <div className="relative w-14 h-14 flex-shrink-0">
                              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                                <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/20" />
                                <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${hasScore(client.health_score) ? client.health_score : 0}, 100`} className={sc.text} />
                              </svg>
                              <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${sc.text}`}>{hasScore(client.health_score) ? client.health_score : "—"}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-sm">{client.client_name}</h3>
                                <Badge className={`${sc.bg} ${sc.text} text-[9px]`}>{client.status.replace("_", " ")}</Badge>
                                {client.mrr > 0 && <Badge variant="outline" className="text-[9px]">${client.mrr.toLocaleString()}/mo</Badge>}
                              </div>
                              {client.risk_factors.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {client.risk_factors.map((f, i) => (
                                    <Badge key={`k-${i}`} variant="outline" className="text-[9px] bg-red-500/5 border-red-500/20 text-red-400">{f}</Badge>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-4 text-[10px] text-muted-foreground">
                                <span>Tickets: {client.metrics.open_tickets} open</span>
                                <span>Devices: {client.metrics.devices} ({client.metrics.offline_devices} offline)</span>
                                <span>Contracts: {client.metrics.active_contracts}</span>
                              </div>
                              <EvidenceCoverage client={client} dense />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {data.at_risk_clients.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground"><Shield className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>No assessed client currently needs attention.</p></div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="opportunities">
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {data.upsell_opportunities.map(client => (
                    <Card key={client.client_id} className="border-cyan-500/20 hover:bg-muted/20 transition-all" data-testid={`opp-client-${client.client_id}`}>
                      <CardContent className="py-4">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                            <Target className="w-5 h-5 text-cyan-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-sm">{client.client_name}</h3>
                              <Badge variant="outline" className="text-[9px] text-cyan-400 border-cyan-500/30">
                                <DollarSign className="w-2.5 h-2.5 mr-0.5" />
                                ${client.opportunities.reduce((s, o) => s + (o.potential_mrr || 0), 0).toLocaleString()} potential
                              </Badge>
                            </div>
                            <div className="space-y-1.5">
                              {client.opportunities.map((opp, i) => (
                                <div key={`k-${i}`} className="flex items-center gap-2 p-2 rounded bg-cyan-500/5 border border-cyan-500/10">
                                  <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                                  <span className="text-xs flex-1">{opp.description}</span>
                                  {opp.potential_mrr > 0 && <span className="text-xs font-mono text-cyan-400">${opp.potential_mrr}/mo</span>}
                                  <Badge variant="outline" className="text-[8px] capitalize">{opp.type}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {data.upsell_opportunities.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground"><TrendingUp className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>No evidence-backed opportunities identified.</p></div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="healthy">
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {data.healthy_clients.map(client => {
                    const sc = scoreColor(client.health_score);
                    return (
                      <div key={client.client_id} className="flex items-center gap-4 p-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-all" data-testid={`healthy-client-${client.client_id}`}>
                        <div className={`w-10 h-10 rounded-full ${sc.bg} flex items-center justify-center`}>
                          <span className={`text-sm font-bold ${sc.text}`}>{hasScore(client.health_score) ? client.health_score : "—"}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{client.client_name}</p>
                          <div className="flex gap-3 text-[10px] text-muted-foreground">
                            <span>{client.metrics.devices} devices</span>
                            <span>{client.metrics.active_contracts} contracts</span>
                            <span>{client.metrics.open_tickets} open tickets</span>
                          </div>
                          <EvidenceCoverage client={client} dense />
                        </div>
                        {client.mrr > 0 && <span className="font-mono text-sm text-emerald-400">${client.mrr.toLocaleString()}/mo</span>}
                      </div>
                    );
                  })}
                  {data.healthy_clients.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground"><Heart className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>No client currently has enough evidence for a healthy rating.</p></div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="unassessed">
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {(data.unassessed_clients || []).map(client => (
                    <Card key={client.client_id} className="border-slate-500/30" data-testid={`unassessed-client-${client.client_id}`}>
                      <CardContent className="py-4">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-lg bg-slate-500/10 flex items-center justify-center flex-shrink-0">
                            <CircleDashed className="w-5 h-5 text-slate-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-sm">{client.client_name}</h3>
                              <Badge variant="outline" className="text-[9px] text-slate-300 border-slate-500/30">Not assessed</Badge>
                              {client.mrr > 0 && <Badge variant="outline" className="text-[9px]">${client.mrr.toLocaleString()}/mo</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">At least two independent evidence dimensions are required before this account can be scored. Record the missing sources below to make it assessable.</p>
                            <EvidenceCoverage client={client} />
                            <ConnectEvidenceAction client={client} onStart={recordEvidenceStart} />
                            <div className="mt-2 flex gap-4 text-[10px] text-muted-foreground">
                              <span>Tickets: {client.metrics.total_tickets}</span>
                              <span>Devices: {client.metrics.devices}</span>
                              <span>Contracts: {client.metrics.active_contracts}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {(data.unassessed_clients || []).length === 0 && (
                    <div className="text-center py-12 text-muted-foreground"><CircleDashed className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>Every client has enough recorded evidence to be scored.</p></div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
