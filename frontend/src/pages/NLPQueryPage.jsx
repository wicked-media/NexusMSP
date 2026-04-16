import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Search, Zap, HelpCircle, Loader2, RefreshCw, Clock, Monitor,
  Ticket, Users, Database, Terminal, ChevronRight, History, Star
} from "lucide-react";

const TYPE_ICONS = { device: Monitor, ticket: Ticket, stat: Users };
const TYPE_COLORS = { device: "text-blue-400 bg-blue-500/10 border-blue-500/30", ticket: "text-amber-400 bg-amber-500/10 border-amber-500/30", stat: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" };

export default function NLPQueryPage() {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [queryHistory, setQueryHistory] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/nlp-query/search?q=`, { headers }).then(r => setSuggestions(r.data.suggestions || []));
    const saved = localStorage.getItem("nlp_query_history");
    if (saved) setQueryHistory(JSON.parse(saved).slice(0, 20));
  }, []);

  const doSearch = useCallback(async (q) => {
    const searchQ = q || query;
    if (!searchQ.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/nlp-query/search?q=${encodeURIComponent(searchQ)}`, { headers });
      setResult(res.data);
      const newHistory = [{ query: searchQ, time: new Date().toISOString(), resultCount: res.data.result_count }, ...queryHistory.filter(h => h.query !== searchQ)].slice(0, 20);
      setQueryHistory(newHistory);
      localStorage.setItem("nlp_query_history", JSON.stringify(newHistory));
    } catch { toast.error("Search failed"); }
    finally { setLoading(false); }
  }, [query, queryHistory, token]);

  const clearHistory = () => {
    setQueryHistory([]);
    localStorage.removeItem("nlp_query_history");
    toast.success("History cleared");
  };

  return (
    <div className="space-y-5" data-testid="nlp-query-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-violet-500 flex items-center justify-center"><Terminal className="w-5 h-5 text-white" /></div>
            Natural Language Search
          </h1>
          <p className="text-muted-foreground mt-1">Ask anything in plain English about your devices, tickets, and clients</p>
        </div>
      </div>

      {/* Search Bar */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder='Try: "Show me all devices with failed patches" or "Which clients have the most tickets?"'
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                className="pl-11 h-12 text-base"
                data-testid="nlp-search-input"
              />
            </div>
            <Button onClick={() => doSearch()} disabled={loading} className="h-12 px-6" data-testid="nlp-search-btn">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              {loading ? "Searching..." : "Search"}
            </Button>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && !result && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><HelpCircle className="w-4 h-4" />Try these queries:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map(s => (
                  <Button key={s} variant="outline" size="sm" className="text-xs hover:bg-primary/10 hover:border-primary/30 transition-colors" onClick={() => { setQuery(s); doSearch(s); }} data-testid={`suggestion-${s.slice(0, 20)}`}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400" />
                {result.interpretation}
              </CardTitle>
              <Badge variant="outline">{result.result_count} result{result.result_count !== 1 ? "s" : ""}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {result.results.length === 0 ? (
              <div className="py-8 text-center">
                <Search className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" />
                <p className="text-muted-foreground">No results found. Try rephrasing your query.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {result.results.map((r, i) => {
                  const Icon = TYPE_ICONS[r.type] || Database;
                  const tc = TYPE_COLORS[r.type] || TYPE_COLORS.device;
                  return (
                    <div key={`k-${i}`} className="flex items-center gap-4 p-3 rounded-lg border border-border/30 hover:bg-muted/30 transition-colors" data-testid={`result-${i}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tc.split(" ").slice(1).join(" ")}`}>
                        <Icon className={`w-4 h-4 ${tc.split(" ")[0]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{r.name || r.title || r.client_name || "Unknown"}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{r.type}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          {r.client_name && <span>Client: {r.client_name}</span>}
                          {r.status && <span>Status: <strong className="text-foreground capitalize">{r.status}</strong></span>}
                          {r.patch_status && <span>Patches: <strong className={r.patch_status === "critical" ? "text-red-400" : "text-foreground"}>{r.patch_status}</strong></span>}
                          {r.priority && <span>Priority: <strong className="text-foreground capitalize">{r.priority}</strong></span>}
                        </div>
                      </div>
                      {r.open_tickets && <Badge className="text-xs">{r.open_tickets} tickets</Badge>}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Query History */}
      {queryHistory.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4 text-muted-foreground" />Recent Queries</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs" onClick={clearHistory}>Clear</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {queryHistory.slice(0, 8).map((h, i) => (
                <div key={`k-${i}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => { setQuery(h.query); doSearch(h.query); }} data-testid={`history-${i}`}>
                  <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm flex-1 truncate">{h.query}</span>
                  <span className="text-[10px] text-muted-foreground">{h.resultCount} results</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(h.time).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
