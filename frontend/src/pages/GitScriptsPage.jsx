import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Play, History } from "lucide-react";

export default function GitScriptsPage() {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/git-scripts/list`, { headers }).then(r => setScripts(r.data)); }, []);

  return (
    <div className="space-y-6" data-testid="git-scripts-page">
      <div><h1 className="text-2xl font-bold">Git Script Library</h1><p className="text-muted-foreground text-sm">Version-controlled scripts with history, diff, and rollback</p></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          {scripts.map(s => (
            <Card key={s.id} className={`cursor-pointer ${selected?.id === s.id ? "border-primary" : ""}`} onClick={() => setSelected(s)}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2"><GitBranch className="w-4 h-4" /><span className="font-medium">{s.name}</span><Badge variant="outline" className="text-xs">{s.language}</Badge><Badge className="text-xs">v{s.version}</Badge></div>
                <div className="text-xs text-muted-foreground mt-1">{s.description}</div>
                <div className="flex gap-2 mt-2">{s.tags.map(t => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}</div>
                <div className="text-xs text-muted-foreground mt-1">By {s.author} | {s.execution_count} runs | {new Date(s.last_modified).toLocaleDateString()}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div>
          {selected ? (
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">{selected.name}</CardTitle></CardHeader>
              <CardContent>
                <pre className="bg-[#0d1117] text-[#c9d1d9] p-4 rounded-lg text-xs font-mono overflow-x-auto max-h-64 border border-[#30363d]">{selected.content}</pre>
                <div className="mt-4">
                  <h4 className="text-sm font-medium flex items-center gap-1 mb-2"><History className="w-4 h-4" />Commit History</h4>
                  <div className="space-y-1">
                    {selected.commits?.map(c => (
                      <div key={c.hash} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted/50">
                        <code className="text-blue-500">{c.hash}</code><span className="flex-1">{c.message}</span><span className="text-muted-foreground">{c.author}</span><span className="text-muted-foreground">{new Date(c.date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : <Card><CardContent className="py-12 text-center text-muted-foreground">Select a script to view</CardContent></Card>}
        </div>
      </div>
    </div>
  );
}
