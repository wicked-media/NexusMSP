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

  const sc = scoreColor(data.overall_score);
  const filteredClients = (data.client_details || []).filter(c =>
    !search || c.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="dmarc-compliance-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Email Security Compliance</h1>
          <p className="text-muted-foreground">DMARC, SPF & MTA-STS posture across all clients</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings")}><ExternalLink className="w-4 h-4 mr-1" />Suped Settings</Button>
        </div>
      </div>

      {/* Score Hero */}
      <div className="grid grid-cols-12 gap-4">
        <Card className={`col-span-4 border-2 ${sc.ring}`} data-testid="overall-score-card">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center">
            <div className={`w-28 h-28 rounded-full flex items-center justify-center border-4 ${sc.ring} mb-3`}>
              <div>
                <p className={`text-4xl font-black ${sc.text}`}>{data.overall_score}%</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{scoreLabel(data.overall_score)}</p>
              </div>
            </div>
            <p className="text-sm font-medium">Overall Compliance Score</p>
            <p className="text-xs text-muted-foreground mt-1">Based on {data.total_clients} client{data.total_clients !== 1 ? "s" : ""} and {data.service_coverage?.length || 6} tracked services</p>
          </CardContent>
        </Card>

        <div className="col-span-8 grid grid-cols-3 gap-3">
          <Card className="border-emerald-500/20" data-testid="fully-protected-card">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-3xl font-black text-emerald-400">{data.fully_protected}</p>
                  <p className="text-xs text-muted-foreground">Fully Protected</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">All 6 services active</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/20" data-testid="partial-card">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <p className="text-3xl font-black text-amber-400">{data.partially_protected}</p>
                  <p className="text-xs text-muted-foreground">Partially Protected</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">Some services missing</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/20" data-testid="unprotected-card">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <ShieldX className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <p className="text-3xl font-black text-red-400">{data.unprotected}</p>
                  <p className="text-xs text-muted-foreground">Unprotected</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">No services configured</p>
            </CardContent>
          </Card>
        </div>
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
                  onClick={() => navigate("/clients")}
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
                  <TableRow key={c.client_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate("/clients")} data-testid={`compliance-row-${c.client_id}`}>
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
