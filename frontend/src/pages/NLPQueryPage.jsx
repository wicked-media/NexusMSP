import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Zap, HelpCircle } from "lucide-react";

export default function NLPQueryPage() {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/nlp-query/search?q=`, { headers }).then(r => setSuggestions(r.data.suggestions || []));
  }, []);

  const doSearch = async (q) => {
    const searchQ = q || query;
    if (!searchQ.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/nlp-query/search?q=${encodeURIComponent(searchQ)}`, { headers });
      setResult(res.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  return (
    <div className="space-y-6" data-testid="nlp-query-page">
      <div>
        <h1 className="text-2xl font-bold">Natural Language Search</h1>
        <p className="text-muted-foreground text-sm">Ask anything in plain English about your devices, tickets, and clients</p>
      </div>
      <Card><CardContent className="pt-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder='Try: "Show me all devices with failed patches" or "Which clients have the most tickets?"' value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} className="pl-9" data-testid="nlp-search-input" />
          </div>
          <Button onClick={() => doSearch()} disabled={loading} data-testid="nlp-search-btn"><Zap className="w-4 h-4 mr-1" />{loading ? "Searching..." : "Search"}</Button>
        </div>
        {suggestions.length > 0 && !result && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><HelpCircle className="w-4 h-4" />Try these queries:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => { setQuery(s); doSearch(s); }}>{s}</Button>)}
            </div>
          </div>
        )}
      </CardContent></Card>
      {result && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">{result.interpretation} <span className="text-muted-foreground font-normal text-sm">({result.result_count} results)</span></CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.results.map((r, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50">
                  <Badge variant="outline" className="text-xs">{r.type}</Badge>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{r.name || r.title || r.client_name}</div>
                    <div className="text-xs text-muted-foreground">{r.client_name && `Client: ${r.client_name}`} {r.status && `| Status: ${r.status}`} {r.patch_status && `| Patches: ${r.patch_status}`} {r.priority && `| Priority: ${r.priority}`}</div>
                  </div>
                  {r.open_tickets && <Badge>{r.open_tickets} tickets</Badge>}
                </div>
              ))}
              {result.results.length === 0 && <p className="text-muted-foreground text-sm py-4 text-center">No results found. Try rephrasing your query.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
