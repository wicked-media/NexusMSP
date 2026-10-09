import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Package, PackageCheck, Search, Terminal, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TYPE_TONE = {
  powershell: "border-cyan-400/25 text-cyan-100",
  bash: "border-emerald-400/25 text-emerald-100",
  batch: "border-amber-400/25 text-amber-100",
  python: "border-violet-400/25 text-violet-100",
};

/**
 * Nexus Script Library — the curated premium catalogue. Browse, inspect and
 * install reviewed scripts into the scripting workspace with provenance, so
 * installed library scripts stay distinguishable from technician-authored ones.
 */
export default function ScriptLibraryPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [entries, setEntries] = useState([]);
  const [filters, setFilters] = useState({ categories: [], os_targets: [], script_types: [] });
  const [categoryCounts, setCategoryCounts] = useState({});
  const [category, setCategory] = useState("");
  const [osTarget, setOsTarget] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [installed, setInstalled] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (category) params.category = category;
      if (osTarget) params.os_target = osTarget;
      if (search.trim()) params.search = search.trim();
      const response = await axios.get(`${API}/script-library`, { headers, params });
      setEntries(response.data?.scripts || []);
      setFilters(response.data?.filters || { categories: [], os_targets: [], script_types: [] });
      setCategoryCounts(response.data?.category_counts || {});
    } catch (error) {
      toast.error(error.response?.data?.detail || "Script Library could not load");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, category, osTarget, search]);

  useEffect(() => { load(); }, [load]);

  const openEntry = useCallback(async (slug) => {
    setBusy(slug);
    try {
      const response = await axios.get(`${API}/script-library/${slug}`, { headers });
      setSelected(response.data?.entry || null);
      setInstalled((prev) => ({ ...prev, [slug]: response.data?.installed || false }));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Library entry could not load");
    } finally {
      setBusy("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const install = async (slug) => {
    setBusy(slug);
    try {
      await axios.post(`${API}/script-library/${slug}/install`, {}, { headers });
      setInstalled((prev) => ({ ...prev, [slug]: true }));
      toast.success("Installed into the scripting workspace.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Install failed");
    } finally {
      setBusy("");
    }
  };

  const uninstall = async (slug) => {
    setBusy(slug);
    try {
      await axios.delete(`${API}/script-library/${slug}/install`, { headers });
      setInstalled((prev) => ({ ...prev, [slug]: false }));
      toast.success("Removed from the scripting workspace.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Remove failed");
    } finally {
      setBusy("");
    }
  };

  const chips = useMemo(
    () => filters.categories.map((c) => ({ id: c, label: c.replace(/-/g, " "), count: categoryCounts[c] || 0 })),
    [filters.categories, categoryCounts]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">Automation</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Nexus Script Library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The curated, reviewed script collection — PowerShell, Bash and Batch, each with declared parameters,
          execution profile and safety posture. Install any script into the scripting workspace with one click.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search scripts, tags…"
            className="h-9 w-64 pl-8 text-xs" data-testid="library-search" />
        </div>
        <select value={osTarget} onChange={(e) => setOsTarget(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-xs" data-testid="library-os-filter">
          <option value="">All platforms</option>
          {filters.os_targets.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {chips.map((chip) => (
          <button key={chip.id} onClick={() => setCategory(category === chip.id ? "" : chip.id)}
            className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${category === chip.id ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100" : "border-border/60 text-muted-foreground hover:border-cyan-400/30"}`}
            data-testid={`library-category-${chip.id}`}>
            {chip.label} · {chip.count}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border/60 bg-background/65">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />{loading ? "Loading…" : `${entries.length} scripts`}
            </p>
            {loading ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading library…</p>
            ) : entries.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground" data-testid="library-empty">No scripts match those filters.</p>
            ) : (
              <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto" data-testid="library-list">
                {entries.map((entry) => (
                  <button key={entry.slug} onClick={() => openEntry(entry.slug)}
                    className="block w-full rounded-xl border border-border/50 p-3 text-left transition-colors hover:border-cyan-400/30"
                    data-testid={`library-entry-${entry.slug}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={TYPE_TONE[entry.script_type] || "border-slate-400/30 text-slate-200"}>{entry.script_type}</Badge>
                      <p className="text-sm font-medium text-foreground">{entry.name}</p>
                      {installed[entry.slug] && <PackageCheck className="h-3.5 w-3.5 text-cyan-300" />}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{entry.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-border/50 px-2 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{tag}</span>
                      ))}
                      {entry.run_as_admin && <span className="rounded-full border border-red-400/25 px-2 py-0.5 text-[9px] uppercase tracking-wide text-red-200">admin</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 bg-background/65">
          <CardContent className="p-4">
            {selected ? (
              <div data-testid="library-detail">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selected.name}</p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{selected.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {installed[selected.slug] ? (
                      <Button size="sm" variant="outline" className="h-8" disabled={busy === selected.slug}
                        onClick={() => uninstall(selected.slug)} data-testid="library-uninstall">
                        {busy === selected.slug ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}Remove
                      </Button>
                    ) : (
                      <Button size="sm" className="h-8" disabled={busy === selected.slug}
                        onClick={() => install(selected.slug)} data-testid="library-install">
                        {busy === selected.slug ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}Install
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                  <div><p className="uppercase tracking-wide text-[9px]">Category</p><p>{selected.category}</p></div>
                  <div><p className="uppercase tracking-wide text-[9px]">Platform</p><p>{selected.os_target}</p></div>
                  <div><p className="uppercase tracking-wide text-[9px]">Timeout</p><p>{selected.timeout_seconds}s</p></div>
                  <div><p className="uppercase tracking-wide text-[9px]">Elevation</p><p>{selected.run_as_admin ? "admin" : "standard"}</p></div>
                </div>
                {selected.parameters?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Parameters</p>
                    <ul className="mt-1 space-y-1">
                      {selected.parameters.map((param) => (
                        <li key={param.name} className="rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{param.name}</span> ({param.type}, default {String(param.default)}) — {param.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Script</p>
                  <pre className="mt-1 max-h-72 overflow-auto rounded-xl border border-border/50 bg-muted/20 p-3 text-[10px] leading-4 text-muted-foreground" data-testid="library-content">
                    {selected.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
                <Package className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Select a script to preview it, inspect its parameters and install it.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
