import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import DOMPurify from "dompurify";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  BookOpen, Users, Package, Globe, ListChecks, KeyRound, Search,
  RefreshCw, Loader2, ExternalLink, Copy, Eye, EyeOff, ChevronRight,
} from "lucide-react";
import { PageShell } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

export default function HuduCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("articles");

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [companies, setCompanies] = useState([]);

  const [articleViewer, setArticleViewer] = useState(null);
  const [revealRequest, setRevealRequest] = useState(null);
  const [passwordReveal, setPasswordReveal] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Summary + companies (extracted so Refresh / Sync can re-call it)
  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const [sumRes, compRes] = await Promise.all([
        axios.get(`${API}/hudu/summary`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/hudu/companies?page_size=100`, { headers }).catch(() => ({ data: { companies: [] } })),
      ]);
      setSummary(sumRes.data);
      setCompanies(compRes.data?.companies || []);
    } finally { setLoadingSummary(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await axios.post(`${API}/hudu/sync`, {}, { headers });
      toast.success(r.data?.message || "Hudu sync complete");
      await loadSummary();
      await loadTab();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync failed");
    } finally { setSyncing(false); }
  };

  // Load tab data
  const loadTab = useCallback(async () => {
    if (!summary) return;
    if (!summary.configured) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setRows([]);
    try {
      const paramsObj = { page_size: 50 };
      if (query) paramsObj.search = query;
      if (query) paramsObj.name = query;
      if (companyFilter) paramsObj.company_id = companyFilter;
      const qs = new URLSearchParams(paramsObj).toString();
      const endpointMap = {
        articles: "articles",
        procedures: "procedures",
        assets: "assets",
        websites: "websites",
        passwords: "passwords",
        companies: "companies",
      };
      const path = endpointMap[activeTab];
      const res = await axios.get(`${API}/hudu/${path}?${qs}`, { headers });
      const keyMap = { articles: "articles", procedures: "procedures", assets: "assets", websites: "websites", passwords: "passwords", companies: "companies" };
      setRows(res.data?.[keyMap[activeTab]] || []);
    } catch (e) {
      if (e.response?.status === 503) toast.error("Hudu not configured — add credentials in Settings");
      else toast.error(e.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  }, [activeTab, query, companyFilter, token, summary?.configured]); // eslint-disable-line

  useEffect(() => { loadTab(); }, [loadTab]);

  const openArticle = async (id) => {
    try { const r = await axios.get(`${API}/hudu/articles/${id}`, { headers }); setArticleViewer(r.data); }
    catch { toast.error("Couldn't load article"); }
  };

  const revealPassword = async (pw) => {
    if (!pw) return;
    setRevealRequest(null);
    setPasswordReveal({ ...pw, password: null });
    setRevealing(true);
    setShowPassword(false);
    try {
      const r = await axios.get(`${API}/hudu/passwords/${pw.id}`, { headers });
      setPasswordReveal(r.data);
      toast.success("Password revealed — reveal audit-logged");
    } catch (e) { toast.error(e.response?.data?.detail || "Reveal failed"); setPasswordReveal(null); }
    finally { setRevealing(false); }
  };

  const notConfigured = summary && !summary.configured;
  const s = summary?.stats || {};
  const activeTabLabel = activeTab === "passwords" ? "credentials" : activeTab;

  return (
    <PageShell data-testid="hudu-command-center">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <OperationalPageHeader
          eyebrow="External documentation"
          title="Hudu"
          description={notConfigured
            ? "Read-only Hudu documentation, assets, websites, and credential references. Connect the Hudu tenant in Settings to begin."
            : summary?.last_synced_at
              ? `Read-only Hudu documentation and credential references. Last synchronised ${new Date(summary.last_synced_at).toLocaleString()}.`
              : "Read-only Hudu documentation, assets, websites, and credential references. Every credential reveal is audited; NexusMSP does not store a copy."}
          icon={BookOpen}
          tone="emerald"
          actions={<>
            {notConfigured && (
              <Button variant="outline" size="sm" asChild data-testid="hudu-configure-btn">
                <Link to="/settings?tab=integrations"><ExternalLink className="w-3 h-3 mr-1" />Configure Hudu</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || notConfigured} data-testid="hudu-sync-btn" title="Pull latest from Hudu and refresh stats">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}{syncing ? "Syncing…" : "Sync now"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { loadSummary(); loadTab(); }} disabled={loading || loadingSummary || notConfigured} data-testid="hudu-refresh-btn">
              {(loading || loadingSummary) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </>}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <HeroTile label="Companies" value={s.companies ?? 0} icon={Users} glow="indigo" subtitle="Hudu customer records" testId="hudu-metric-companies" />
          <HeroTile label="Articles" value={s.articles ?? 0} icon={BookOpen} glow="emerald" subtitle="Knowledge references" testId="hudu-metric-articles" />
          <HeroTile label="Assets" value={s.assets ?? 0} icon={Package} glow="sky" subtitle="External asset records" testId="hudu-metric-assets" />
          <HeroTile label="Procedures" value={s.procedures ?? 0} icon={ListChecks} glow="violet" subtitle="Runbook references" testId="hudu-metric-procedures" />
          <HeroTile label="Websites" value={s.websites ?? 0} icon={Globe} glow="cyan" subtitle="Documented services" testId="hudu-metric-websites" />
          <HeroTile label="Credentials" value={s.passwords ?? 0} icon={KeyRound} glow="amber" subtitle="Hudu-held only" testId="hudu-metric-passwords" />
        </div>

        {/* Filter bar */}
        <Card>
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder={`Search ${activeTabLabel}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadTab()}
                data-testid="hudu-search-input"
              />
            </div>
            {["articles", "procedures", "assets", "websites", "passwords"].includes(activeTab) && companies.length > 0 && (
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="bg-background border border-border rounded px-2 py-2 text-xs h-9"
                data-testid="hudu-company-filter"
              >
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={loadTab} disabled={loading} data-testid="hudu-apply-filter">
              Apply
            </Button>
            {(query || companyFilter) && (
              <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setCompanyFilter(""); }}>Clear</Button>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full md:w-auto" data-testid="hudu-tabs">
            <TabsTrigger value="articles" data-testid="hudu-tab-articles"><BookOpen className="w-3 h-3 mr-1" />Articles</TabsTrigger>
            <TabsTrigger value="procedures" data-testid="hudu-tab-procedures"><ListChecks className="w-3 h-3 mr-1" />Procedures</TabsTrigger>
            <TabsTrigger value="passwords" data-testid="hudu-tab-passwords"><KeyRound className="w-3 h-3 mr-1" />Credentials</TabsTrigger>
            <TabsTrigger value="assets" data-testid="hudu-tab-assets"><Package className="w-3 h-3 mr-1" />Assets</TabsTrigger>
            <TabsTrigger value="websites" data-testid="hudu-tab-websites"><Globe className="w-3 h-3 mr-1" />Websites</TabsTrigger>
            <TabsTrigger value="companies" data-testid="hudu-tab-companies"><Users className="w-3 h-3 mr-1" />Companies</TabsTrigger>
          </TabsList>

          {/* Generic results table (varies slightly per tab) */}
          <TabsContent value={activeTab}>
            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading {activeTabLabel}…
                  </div>
                ) : rows.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    {notConfigured ? "Hudu not configured. Add credentials in Settings → Integrations → Hudu." : `No ${activeTabLabel} match your filters.`}
                  </div>
                ) : activeTab === "passwords" ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase tracking-widest">Name</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest">Username</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest">URL</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest">Company</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((p) => (
                        <TableRow key={p.id} data-testid={`hudu-pw-row-${p.id}`}>
                          <TableCell className="font-medium text-sm">{p.name}</TableCell>
                          <TableCell className="text-xs font-mono">{p.username || "—"}</TableCell>
                          <TableCell className="text-xs font-mono text-sky-400 max-w-xs truncate">{p.url || "—"}</TableCell>
                          <TableCell className="text-xs">{p.company_name || "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setRevealRequest(p)} data-testid={`hudu-pw-reveal-${p.id}`}>
                              <Eye className="w-3 h-3 mr-1" />Reveal
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : activeTab === "companies" ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Phone</TableHead><TableHead>City</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.map((c) => (
                        <TableRow key={c.id} data-testid={`hudu-company-row-${c.id}`}>
                          <TableCell className="font-medium text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs font-mono">{c.phone_number || c.phone || "—"}</TableCell>
                          <TableCell className="text-xs">{c.city || "—"}</TableCell>
                          <TableCell className="text-right">
                            {c.url && <Button size="sm" variant="ghost" asChild><a href={c.url} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" /></a></Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : activeTab === "articles" || activeTab === "procedures" ? (
                  <div className="divide-y divide-border">
                    {rows.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => openArticle(a.id)}
                        className="w-full text-left px-4 py-3 hover:bg-muted/30 flex items-start justify-between gap-3"
                        data-testid={`hudu-${activeTab}-row-${a.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{a.name || a.title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                            {a.company_name && <Badge variant="outline" className="text-[9px]">{a.company_name}</Badge>}
                            {a.updated_at && <span>Updated {new Date(a.updated_at).toLocaleDateString()}</span>}
                          </div>
                          {a.content && (
                            <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                              {a.content.replace(/<[^>]+>/g, " ").slice(0, 200)}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground mt-1" />
                      </button>
                    ))}
                  </div>
                ) : activeTab === "websites" ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Site</TableHead><TableHead>Company</TableHead><TableHead>Cert expiry</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.map((w) => (
                        <TableRow key={w.id} data-testid={`hudu-website-row-${w.id}`}>
                          <TableCell className="font-medium text-sm text-sky-400">
                            <a href={w.name?.startsWith("http") ? w.name : `https://${w.name}`} target="_blank" rel="noreferrer" className="hover:underline">{w.name}</a>
                          </TableCell>
                          <TableCell className="text-xs">{w.company_name || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{w.cert_expiry_date ? new Date(w.cert_expiry_date).toLocaleDateString() : "—"}</TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  // Assets
                  <Table>
                    <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Type</TableHead><TableHead>Company</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.map((a) => (
                        <TableRow key={a.id} data-testid={`hudu-asset-row-${a.id}`}>
                          <TableCell className="font-medium text-sm">{a.name}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{a.asset_type || a.asset_layout_id || "—"}</Badge></TableCell>
                          <TableCell className="text-xs">{a.company_name || "—"}</TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{a.updated_at ? new Date(a.updated_at).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Article viewer */}
      <Dialog open={!!articleViewer} onOpenChange={() => setArticleViewer(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="hudu-article-viewer">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-emerald-400" />{articleViewer?.name || articleViewer?.title}</DialogTitle>
          </DialogHeader>
          {articleViewer && (
            <div className="space-y-3">
              <div className="text-[10px] text-muted-foreground font-mono">
                {articleViewer.company_name ? `${articleViewer.company_name} · ` : ""}
                Updated {articleViewer.updated_at ? new Date(articleViewer.updated_at).toLocaleString() : "—"}
                {articleViewer.url && <> · <a href={articleViewer.url} target="_blank" rel="noreferrer" className="text-primary underline">Open in Hudu</a></>}
              </div>
              <div
                className="prose prose-invert max-w-none prose-sm text-sm"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(articleViewer.content || "(no content)") }}
              />
              <Button size="sm" variant="outline"
                onClick={() => { navigator.clipboard.writeText((articleViewer.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); toast.success("Copied"); }}>
                <Copy className="w-3 h-3 mr-1" />Copy text
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deliberate credential reveal confirmation */}
      <Dialog open={!!revealRequest} onOpenChange={(open) => { if (!open) setRevealRequest(null); }}>
        <DialogContent className="max-w-md" data-testid="hudu-password-reveal-confirmation">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-400" />Reveal Hudu credential?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>You are about to reveal <span className="font-semibold">{revealRequest?.name}</span> from Hudu.</p>
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
              This is a read-only Hudu lookup. NexusMSP records who revealed the credential and when; it does not store a copy.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevealRequest(null)}>Cancel</Button>
            <Button onClick={() => revealPassword(revealRequest)} data-testid="confirm-hudu-password-reveal"><Eye className="mr-2 h-4 w-4" />Reveal and audit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password reveal */}
      <Dialog open={!!passwordReveal} onOpenChange={() => { setPasswordReveal(null); setShowPassword(false); }}>
        <DialogContent className="max-w-md" data-testid="hudu-password-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" />{passwordReveal?.name}</DialogTitle>
          </DialogHeader>
          {passwordReveal && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <Row k="Username" v={passwordReveal.username} copy />
                <Row k="URL" v={passwordReveal.url} copy />
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Password</div>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 font-mono text-sm bg-background/60 px-2 py-1 rounded border border-border break-all">
                      {revealing ? "Revealing…" : (showPassword ? (passwordReveal.password || "(none)") : "•".repeat(Math.min(24, (passwordReveal.password || "").length || 12)))}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => setShowPassword((v) => !v)} data-testid="hudu-pw-toggle-visibility">
                      {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(passwordReveal.password || ""); toast.success("Password copied"); }} data-testid="hudu-pw-copy">
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {passwordReveal.notes && <Row k="Notes" v={passwordReveal.notes.replace(/<[^>]+>/g, " ")} />}
              </div>
              <div className="text-[10px] text-muted-foreground">
                ⚠ This reveal is audit-logged (who + when) in db.hudu_password_reveals.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Row({ k, v, copy }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{k}</div>
      <div className="flex items-center gap-2 mt-0.5">
        <code className="flex-1 font-mono text-xs bg-background/60 px-2 py-1 rounded border border-border break-all">{v || "—"}</code>
        {copy && v && (
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(v); toast.success(`${k} copied`); }}>
            <Copy className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
