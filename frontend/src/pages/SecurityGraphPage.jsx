import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bug,
  CalendarClock,
  ExternalLink,
  Fingerprint,
  GitBranch,
  Loader2,
  Monitor,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const SEVERITY = {
  critical:
    "border-rose-500/30 bg-rose-500/[0.08] text-rose-700 dark:text-rose-200",
  high: "border-orange-500/30 bg-orange-500/[0.08] text-orange-700 dark:text-orange-200",
  medium:
    "border-amber-500/30 bg-amber-500/[0.08] text-amber-700 dark:text-amber-200",
  low: "border-sky-500/30 bg-sky-500/[0.08] text-sky-700 dark:text-sky-200",
};

const NODE_STYLE = {
  identity: {
    icon: Fingerprint,
    style:
      "border-violet-500/25 bg-violet-500/[0.06] text-violet-700 dark:text-violet-100",
  },
  endpoint: {
    icon: Monitor,
    style:
      "border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-700 dark:text-cyan-100",
  },
  control: {
    icon: ShieldAlert,
    style:
      "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-100",
  },
  detection: {
    icon: Bug,
    style:
      "border-rose-500/25 bg-rose-500/[0.06] text-rose-700 dark:text-rose-100",
  },
  client: {
    icon: Users,
    style:
      "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-100",
  },
};

const formatDateTime = (value) => {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time not recorded"
    : date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

function AttackPath({ path }) {
  return (
    <Card
      className="overflow-hidden border-border/80 bg-card"
      data-testid={`security-path-${path.id}`}
    >
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-gradient-to-r from-muted/75 via-card to-cyan-500/[0.05] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {path.title}
              </h2>
              <Badge
                variant="outline"
                className={SEVERITY[path.severity] || SEVERITY.medium}
              >
                {path.severity}
              </Badge>
              <Badge
                variant="outline"
                className="border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-200"
              >
                {path.confidence}
              </Badge>
              {path.event_count > 1 && (
                <Badge variant="outline">{path.event_count} signals grouped</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {path.client_name} · {path.source}
            </p>
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-8 border-cyan-500/25 bg-cyan-500/[0.04] text-cyan-700 dark:text-cyan-100"
          >
            <Link to={path.source_route}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open evidence
            </Link>
          </Button>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {path.summary}
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Last observed {formatDateTime(path.observed_at)}
            </span>
          </div>
          <div className="mt-4 overflow-x-auto pb-2">
            <div className="flex min-w-max items-stretch gap-2">
              {(path.nodes || []).map((node, index) => {
                const nodeTone = NODE_STYLE[node.type] || NODE_STYLE.control;
                const NodeIcon = nodeTone.icon;
                const edge = (path.edges || []).find(
                  (item) => item.target === node.id,
                );
                return (
                  <div key={node.id} className="flex items-center gap-2">
                    {index > 0 && (
                      <div className="flex w-28 flex-col items-center">
                        <span className="mb-1 max-w-28 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
                          {edge?.relationship || "linked to"}
                        </span>
                        <ArrowRight className="h-4 w-4 text-cyan-500/60" />
                      </div>
                    )}
                    <div
                      className={`w-48 rounded-xl border p-3 ${nodeTone.style}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-background/20">
                          <NodeIcon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">
                            {node.label}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed opacity-65">
                            {node.detail}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Observed evidence
              </p>
              <div className="mt-2 space-y-1.5">
                {(path.evidence || []).map((evidence, index) => (
                  <div
                    key={`${path.id}-evidence-${index}`}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                    <span>{evidence}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.035] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300/80">
                Highest-impact next step
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {path.recommended_action}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SecurityGraphPage() {
  const { token } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/security-graph/overview`, {
        headers,
        params: clientId === "all" ? {} : { client_id: clientId },
      });
      setData(response.data);
    } catch (error) {
      const message =
        error.response?.data?.detail || "Security Graph could not be loaded";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [clientId, headers]);

  useEffect(() => {
    load();
  }, [load]);

  const paths = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.paths || []).filter((path) => {
      if (severity !== "all" && path.severity !== severity) return false;
      if (!query) return true;
      return [
        path.title,
        path.client_name,
        path.source,
        path.summary,
        ...(path.evidence || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [data, search, severity]);

  const summary = data?.summary || {};
  const hasActiveFilters = Boolean(
    search.trim() || clientId !== "all" || severity !== "all",
  );
  const clearFilters = () => {
    setSearch("");
    setClientId("all");
    setSeverity("all");
  };

  return (
    <div className="space-y-6" data-testid="security-graph-page">
      <OperationalPageHeader
        eyebrow="Security workspace · relationship-aware exposure"
        title="Security Graph"
        description="Follow observed identity, endpoint, control, detection, and client relationships. Nexus shows only attributable paths and leaves missing connector evidence unknown."
        icon={GitBranch}
        tone="amber"
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/security-dashboard">
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                SOC dashboard
              </Link>
            </Button>
            <Button size="sm" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Refresh evidence
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <HeroTile
          label="Observed paths"
          value={summary.paths ?? "—"}
          icon={GitBranch}
          glow="cyan"
          subtitle="Evidence-backed chains"
        />
        <HeroTile
          label="Critical"
          value={summary.critical ?? "—"}
          icon={ShieldAlert}
          glow={(summary.critical || 0) > 0 ? "rose" : "zinc"}
          subtitle="Immediate review"
        />
        <HeroTile
          label="High risk"
          value={summary.high ?? "—"}
          icon={Bug}
          glow={(summary.high || 0) > 0 ? "amber" : "zinc"}
          subtitle="Prioritised exposure"
        />
        <HeroTile
          label="Clients affected"
          value={summary.affected_clients ?? "—"}
          icon={Users}
          glow="violet"
          subtitle="Recorded relationships"
        />
        <HeroTile
          label="Identities observed"
          value={summary.observed_identities ?? "—"}
          icon={Fingerprint}
          glow="sky"
          subtitle="Endpoint-attributed users"
        />
        <HeroTile
          label="Evidence sources"
          value={summary.sources ?? "—"}
          icon={Network}
          glow="emerald"
          subtitle="Connected records"
        />
      </div>

      <Card className="border-cyan-500/15 bg-gradient-to-r from-cyan-500/[0.035] via-transparent to-emerald-500/[0.025]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-600 dark:text-cyan-300">
              <Network className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                Evidence boundary
              </p>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                {data?.evidence_note ||
                  "Loading the current evidence boundary…"}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-200"
          >
            No synthetic attack paths
          </Badge>
        </CardContent>
      </Card>

      {loadError && (
        <Card className="border-rose-500/25 bg-rose-500/[0.04]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Evidence refresh failed
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {loadError}
                {data ? " Existing evidence remains visible below." : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder="Search paths, clients, endpoints, controls, or evidence…"
            aria-label="Search security paths"
          />
        </div>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-full lg:w-64">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {(data?.filters?.clients || []).map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs
          value={severity}
          onValueChange={setSeverity}
          className="overflow-x-auto"
        >
          <TabsList className="min-w-max">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="critical">Critical</TabsTrigger>
            <TabsTrigger value="high">High</TabsTrigger>
            <TabsTrigger value="medium">Medium</TabsTrigger>
          </TabsList>
        </Tabs>
        {hasActiveFilters && (
          <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {loading && !data ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Building the evidence graph…
        </div>
      ) : paths.length ? (
        <div className="space-y-4">
          {paths.map((path) => (
            <AttackPath key={path.id} path={path} />
          ))}
        </div>
      ) : (
        <Card className="border-emerald-500/15 bg-emerald-500/[0.025]">
          <CardContent className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
            <h2 className="mt-3 text-sm font-semibold text-foreground">
              No attributable paths match this view
            </h2>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
              This is not a pass or certification. It means the currently
              connected evidence sources have not recorded a matching
              relationship.
            </p>
            {hasActiveFilters && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
