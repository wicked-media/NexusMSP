import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Shield, ShieldCheck, ShieldX, AlertTriangle, CheckCircle, XCircle,
  Search, Loader2, RefreshCw, ExternalLink, TrendingUp, Users,
  MailCheck, Lock, Globe, Server, ArrowUpRight, Eye
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const scoreColor = (score) => {
  if (score >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500", ring: "ring-emerald-500/30" };
  if (score >= 50) return { text: "text-amber-400", bg: "bg-amber-500", ring: "ring-amber-500/30" };
  return { text: "text-red-400", bg: "bg-red-500", ring: "ring-red-500/30" };
};

const scoreLabel = (score) => {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 20) return "Poor";
  return "Critical";
};

export default function DmarcCompliancePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/suped/compliance-dashboard`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load compliance data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const filteredClients = (data.client_details || []).filter(c =>
    !search || c.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="dmarc-compliance-page">
      <OperationalPageHeader
        eyebrow="Network workspace · email security"
        title="Email security compliance"
        description="DMARC, SPF, MTA-STS and blocklist posture across every client, with direct paths to the affected account."
        icon={Shield}
        tone="sky"
        actions={(
          <>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=integrations&anchor=suped-settings-card")}><ExternalLink className="w-4 h-4 mr-1" />Suped Settings</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Compliance score" value={data.overall_score ?? 0} suffix="%" icon={Shield} glow={data.overall_score >= 80 ? "emerald" : data.overall_score >= 50 ? "amber" : "rose"} subtitle={`${scoreLabel(data.overall_score)} · ${data.total_clients || 0} clients`} testId="overall-score-card" />
        <HeroTile label="Fully protected" value={data.fully_protected ?? 0} icon={ShieldCheck} glow="emerald" subtitle="All monitored services active" testId="fully-protected-card" />
        <HeroTile label="Partially protected" value={data.partially_protected ?? 0} icon={AlertTriangle} glow="amber" subtitle="One or more controls missing" testId="partial-card" />
        <HeroTile label="Unprotected" value={data.unprotected ?? 0} icon={ShieldX} glow={(data.unprotected ?? 0) > 0 ? "rose" : "zinc"} subtitle="Requires a protection plan" testId="unprotected-card" />
      </div>

      {/* Service Coverage */}
      <Card data-testid="service-coverage-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-500" />Service Coverage Across Fleet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data.service_coverage || []).map(svc => {
            const pct = svc.total > 0 ? Math.round((svc.active / svc.total) * 100) : 0;
            const c = scoreColor(pct);
            return (
              <div key={svc.name} className="space-y-1" data-testid={`coverage-${svc.name}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{svc.name}</span>
                  <span className={`font-mono text-xs ${c.text}`}>{svc.active}/{svc.total} clients ({pct}%)</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Clients At Risk */}
      {data.at_risk && data.at_risk.length > 0 && (
        <Card className="border-red-500/20" data-testid="at-risk-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Clients Needing Attention ({data.at_risk.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.at_risk.slice(0, 8).map(c => {
              const cs = scoreColor(c.score);
              return (
                <div
                  key={c.client_id}
                  className="flex items-center justify-between p-3 rounded-lg border border-red-500/10 bg-red-500/5 hover:bg-red-500/8 cursor-pointer transition-colors"
                  onClick={() => navigate(`/clients?client=${c.client_id}`)}
                  data-testid={`risk-client-${c.client_id}`}
                >
                  <div className="flex items-center gap-3">
                    <ShieldX className="w-5 h-5 text-red-400" />
                    <div>
                      <p className="font-medium text-sm">{c.client_name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.active_services}/{c.total_services} services active {!c.has_suped && "| No Suped Org ID"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`text-xl font-black ${cs.text}`}>{c.score}%</div>
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Full Client Table */}
      <Card data-testid="client-compliance-table">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />All Clients ({filteredClients.length})</CardTitle>
          <div className="relative w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9 h-8 text-sm" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} data-testid="compliance-search" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead className="text-center">DMARC</TableHead>
                <TableHead className="text-center">Hosted DMARC</TableHead>
                <TableHead className="text-center">Hosted SPF</TableHead>
                <TableHead className="text-center">MTA-STS</TableHead>
                <TableHead className="text-center">SPF Flatten</TableHead>
                <TableHead className="text-center">Blocklist</TableHead>
                <TableHead className="text-center">Suped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClients.map(c => {
                const cs = scoreColor(c.score);
                const svc = c.services || {};
                const ServiceBadge = ({ active }) => (
                  active
                    ? <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" />
                    : <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                );
                return (
                  <TableRow key={c.client_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients?client=${c.client_id}`)} data-testid={`compliance-row-${c.client_id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {c.score >= 80 ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : c.score >= 50 ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <ShieldX className="w-4 h-4 text-red-400" />}
                        <span className="font-medium text-sm">{c.client_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={`text-xs ${cs.text} ${cs.bg}/10 border-transparent`}>{c.score}%</Badge>
                    </TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.dmarc_monitoring} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.hosted_dmarc} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.hosted_spf} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.hosted_mta_sts} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.spf_flattening} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.blocklist_monitoring} /></TableCell>
                    <TableCell className="text-center">
                      {c.has_suped
                        ? <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px]">Linked</Badge>
                        : <Badge className="bg-muted text-muted-foreground text-[10px]">Not Linked</Badge>
                      }
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredClients.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No clients found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
