import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GitBranch, History, Download, RefreshCw, Code } from "lucide-react";

export default function GitScriptsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  const fetchScripts = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/git-scripts/list`, { headers });
      setScripts(response.data);
    } catch {
      toast.error("Could not load Git scripts");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchScripts(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const importToScriptLibrary = async (script) => {
    if (!script) return;
    setImportingId(script.id);
    try {
      const existing = await axios.get(`${API}/scripts`, { headers });
      const duplicate = existing.data.find((item) => item.name === script.name && item.content === script.content);
      if (duplicate) {
        toast.success("This version is already in My Scripts");
        navigate("/scripting");
        return;
      }
      const isBash = script.language === "bash" || script.language === "shell";
      await axios.post(`${API}/scripts`, {
        name: script.name,
        description: `${script.description || ""} Imported from Git Script Library (v${script.version}).`.trim(),
        script_type: isBash ? "bash" : script.language === "python" ? "python" : "powershell",
        content: script.content,
        category: script.tags?.includes("security") ? "security" : script.tags?.includes("maintenance") ? "maintenance" : "general",
        os_target: isBash ? "linux" : "windows",
        run_as_admin: !isBash,
        timeout_seconds: 300,
      }, { headers });
      toast.success(`${script.name} added to My Scripts`);
      navigate("/scripting");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not import this script");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="git-scripts-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-bold">Git Script Library</h1><p className="text-muted-foreground text-sm">Version-controlled scripts with history, review context, and one-click import into the main library.</p></div><div className="flex gap-2"><Button variant="outline" onClick={fetchScripts} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button onClick={() => navigate("/scripting")} data-testid="open-main-script-library"><Code className="mr-2 h-4 w-4" />My Scripts</Button></div></div>
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
                <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => importToScriptLibrary(selected)} disabled={importingId === selected.id} data-testid="import-git-script"><Download className="mr-2 h-4 w-4" />{importingId === selected.id ? "Importing…" : "Import to My Scripts"}</Button><Button variant="outline" onClick={() => navigate("/scripting")}><Code className="mr-2 h-4 w-4" />Open My Scripts</Button></div>
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
