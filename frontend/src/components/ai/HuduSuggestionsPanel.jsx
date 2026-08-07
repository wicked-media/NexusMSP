import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BookOpen, Sparkles, RefreshCw, Loader2, ExternalLink, Copy, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Compact Hudu KB suggestions panel for the ticket detail view.
 * Runs /hudu/suggest-for-ticket with the ticket content — returns article/procedure hits
 * plus Nexus AI distilled fix steps.
 */
export function HuduSuggestionsPanel({ ticket }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullArticle, setFullArticle] = useState(null);

  const run = useCallback(async () => {
    if (!ticket?.id) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/hudu/suggest-for-ticket`, {
        ticket_id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        use_ai: true,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setData(res.data);
      if (res.data && !res.data.configured) {
        toast.error("Hudu not configured — add credentials in Settings → Integrations");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Hudu suggestion failed");
    } finally { setLoading(false); }
  }, [ticket?.description, ticket?.id, ticket?.title, token]);

  // Auto-run once on mount
  useEffect(() => { run(); }, [run]);

  const openArticle = async (id) => {
    try {
      const res = await axios.get(`${API}/hudu/articles/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setFullArticle(res.data);
    } catch (e) { toast.error("Couldn't load article"); }
  };

  const picks = data?.ai?.parsed?.picks || [];
  const totalHits = (data?.articles?.length || 0) + (data?.procedures?.length || 0);

  if (!data && !loading) return null;

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5" data-testid="hudu-suggestions-panel">
      <CardContent className="p-0">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-left"
          onClick={() => setExpanded((v) => !v)}
          data-testid="hudu-toggle"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold">Hudu KB Suggestions</span>
            {loading ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : (
              <Badge variant="outline" className="text-[10px]">{totalHits} hit{totalHits === 1 ? "" : "s"}</Badge>
            )}
            {picks.length > 0 && <Badge className="text-[10px] bg-indigo-500/20 text-indigo-400 border-indigo-500/30"><Sparkles className="w-2.5 h-2.5 mr-1" />AI picked {picks.length}</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <span
              role="button"
              tabIndex={0}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={(e) => { e.stopPropagation(); run(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); run(); } }}
              data-testid="hudu-refresh-btn"
            >
              <RefreshCw className="w-3 h-3" />
            </span>
            {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
          </div>
        </button>

        {expanded && (
          <div className="border-t border-emerald-500/20 px-4 py-3 space-y-3">
            {!data?.configured && (
              <div className="text-xs text-muted-foreground">
                Hudu not configured. Add URL + API key in <a href="/settings?tab=integrations" className="text-primary underline">Settings → Integrations</a>.
              </div>
            )}

            {/* AI picks */}
            {picks.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />AI-recommended fixes
                </div>
                {picks.map((p, i) => {
                  const source = [...(data?.articles || []), ...(data?.procedures || [])].find((x) => x.id === p.id);
                  return (
                    <div key={`p-${i}`} className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3" data-testid={`hudu-pick-${i}`}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{source?.name || `#${p.id}`}</div>
                        <div className="flex gap-1">
                          {source?.url && (
                            <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
                              <a href={source.url} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" /></a>
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => openArticle(p.id)} data-testid={`hudu-open-pick-${i}`}>
                            Open
                          </Button>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 italic">{p.why}</div>
                      {Array.isArray(p.fix) && p.fix.length > 0 && (
                        <ol className="mt-2 list-decimal list-inside space-y-0.5 text-xs text-zinc-200">
                          {p.fix.map((step, j) => (
                            <li key={`fx-${i}-${j}`}>{step}</li>
                          ))}
                        </ol>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]"
                          onClick={() => { navigator.clipboard.writeText(`${source?.name}\n\n${(p.fix || []).map((s) => `• ${s}`).join("\n")}`); toast.success("Fix copied"); }}
                          data-testid={`hudu-copy-fix-${i}`}
                        >
                          <Copy className="w-2.5 h-2.5 mr-1" />Copy fix steps
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Raw hits */}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">All matches</div>
              {totalHits === 0 ? (
                <div className="text-xs text-muted-foreground">No Hudu articles or procedures matched "<span className="font-mono">{data?.query || "—"}</span>"</div>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(data?.articles || []).map((a) => (
                    <button key={`a-${a.id}`} className="w-full text-left px-2 py-1.5 rounded hover:bg-background/50 flex items-center justify-between" onClick={() => openArticle(a.id)} data-testid={`hudu-article-${a.id}`}>
                      <div className="min-w-0">
                        <div className="text-xs truncate">{a.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{a.company_name || "—"} · {a.snippet?.slice(0, 80)}…</div>
                      </div>
                      <Badge variant="outline" className="text-[9px] ml-2">article</Badge>
                    </button>
                  ))}
                  {(data?.procedures || []).map((p) => (
                    <button key={`p-${p.id}`} className="w-full text-left px-2 py-1.5 rounded hover:bg-background/50 flex items-center justify-between" onClick={() => openArticle(p.id)} data-testid={`hudu-procedure-${p.id}`}>
                      <div className="min-w-0">
                        <div className="text-xs truncate">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{p.snippet?.slice(0, 80)}…</div>
                      </div>
                      <Badge variant="outline" className="text-[9px] ml-2">procedure</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>

      {/* Full article viewer */}
      <Dialog open={!!fullArticle} onOpenChange={() => setFullArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="hudu-article-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              {fullArticle?.name || fullArticle?.title || "Hudu article"}
            </DialogTitle>
          </DialogHeader>
          {fullArticle && (
            <div className="space-y-3">
              <div className="text-[10px] text-muted-foreground font-mono">
                {fullArticle.company_name ? `${fullArticle.company_name} · ` : ""}
                Updated {fullArticle.updated_at ? new Date(fullArticle.updated_at).toLocaleString() : "—"}
                {fullArticle.url && <> · <a href={fullArticle.url} target="_blank" rel="noreferrer" className="text-primary underline">Open in Hudu</a></>}
              </div>
              <div
                className="prose prose-invert max-w-none prose-sm text-sm"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: fullArticle.content || "(no content)" }}
              />
              <div>
                <Button size="sm" variant="outline"
                  onClick={() => { navigator.clipboard.writeText(fullArticle.content?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") || ""); toast.success("Content copied"); }}
                >
                  <Copy className="w-3 h-3 mr-1" />Copy text
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
