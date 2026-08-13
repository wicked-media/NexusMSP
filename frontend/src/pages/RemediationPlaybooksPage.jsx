import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import {
  AlertTriangle,
  Ban,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileWarning,
  Link2,
  Loader2,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TicketCheck,
} from "lucide-react";
import { toast } from "sonner";

const severityVariant = {
  critical: "destructive",
  high: "warning",
  medium: "secondary",
  low: "secondary",
};
const emptyRunbook = () => ({
  name: "",
  description: "",
  trigger: "manual",
  severity: "medium",
  steps: [{ action: "review", description: "" }],
});
const emptyLaunch = () => ({
  client_id: "",
  device_id: "",
  ticket_id: "",
  trigger_reference: "",
  scope_note: "",
});
const formatDateTime = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function InlineRecordPicker({
  id,
  label,
  options,
  value,
  onChange,
  getLabel,
  getDescription,
  placeholder,
  emptyText,
  disabled = false,
  required = false,
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selected = options.find((option) => option.id === value);
  const normalized = query.trim().toLowerCase();
  const matches = options
    .filter((option) => {
      if (!normalized) return true;
      return `${getLabel(option)} ${getDescription(option)}`
        .toLowerCase()
        .includes(normalized);
    })
    .slice(0, 30);

  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id={id}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder={placeholder}
          className="pl-9"
          autoComplete="off"
          disabled={disabled}
        />
        {focused && !disabled && (
          <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-1.5 shadow-2xl shadow-black/50">
            {matches.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                {emptyText}
              </p>
            ) : (
              matches.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.id);
                    setQuery(getLabel(option));
                    setFocused(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">
                      {getLabel(option)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {getDescription(option)}
                    </span>
                  </span>
                  {option.id === value && (
                    <Check className="h-4 w-4 shrink-0 text-emerald-300" />
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {selected && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
          <p className="truncate text-sm font-medium text-emerald-100">
            {getLabel(selected)}
          </p>
          <p className="mt-0.5 truncate text-xs text-emerald-100/65">
            {getDescription(selected)}
          </p>
        </div>
      )}
    </div>
  );
}

export default function RemediationPlaybooksPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [playbooks, setPlaybooks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [runbookForm, setRunbookForm] = useState(emptyRunbook);
  const [blockedStep, setBlockedStep] = useState(null);
  const [blockedNote, setBlockedNote] = useState("");
  const [launchPlaybook, setLaunchPlaybook] = useState(null);
  const [launchForm, setLaunchForm] = useState(emptyLaunch);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [devices, setDevices] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [loadError, setLoadError] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [selectedHistorySession, setSelectedHistorySession] = useState(null);
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [playbookResponse, sessionResponse] = await Promise.all([
        axios.get(`${API}/remediation-playbooks/list`, { headers }),
        axios.get(`${API}/remediation-playbooks/executions`, { headers }),
      ]);
      setPlaybooks(playbookResponse.data || []);
      setSessions(sessionResponse.data || []);
      setActiveSession(
        (current) =>
          current ||
          (sessionResponse.data || []).find(
            (session) => session.status === "in_progress",
          ) ||
          null,
      );
    } catch (error) {
      const message =
        error.response?.data?.detail || "Could not load response runbooks";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openLaunch = async (playbook) => {
    setLaunchPlaybook(playbook);
    setLaunchForm(emptyLaunch());
    setLaunchLoading(true);
    try {
      const [clientResponse, deviceResponse, ticketResponse] =
        await Promise.all([
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/devices`, { headers }),
          axios.get(`${API}/tickets`, { headers }),
        ]);
      setClients(Array.isArray(clientResponse.data) ? clientResponse.data : []);
      setDevices(Array.isArray(deviceResponse.data) ? deviceResponse.data : []);
      setTickets(Array.isArray(ticketResponse.data) ? ticketResponse.data : []);
    } catch (error) {
      toast.error(
        error.response?.data?.detail ||
          "Client, endpoint, and ticket records could not be loaded",
      );
    } finally {
      setLaunchLoading(false);
    }
  };

  const start = async () => {
    if (!launchPlaybook) return;
    if (!launchForm.client_id) {
      toast.error("Choose the client this response protects");
      return;
    }
    if (launchForm.scope_note.trim().length < 12) {
      toast.error("Record the observed signal and response scope");
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/remediation-playbooks/${launchPlaybook.id}/start`,
        {
          ...launchForm,
          trigger_reference: launchForm.trigger_reference.trim() || undefined,
          scope_note: launchForm.scope_note.trim(),
        },
        { headers },
      );
      setActiveSession(response.data);
      setSessions((current) => [response.data, ...current]);
      setLaunchPlaybook(null);
      setLaunchForm(emptyLaunch());
      toast.success("Guided response session started and audited");
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not start the response session",
      );
    } finally {
      setSaving(false);
    }
  };

  const recordStep = async (step, outcome, note = "") => {
    if (!activeSession) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/remediation-playbooks/executions/${activeSession.id}/steps/${step.order}`,
        { outcome, note },
        { headers },
      );
      setActiveSession(response.data);
      setSessions((current) =>
        current.map((session) =>
          session.id === response.data.id ? response.data : session,
        ),
      );
      toast.success(`Step marked ${outcome.replace("_", " ")}`);
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not record that response step",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitBlockedStep = async () => {
    if (!blockedStep || blockedNote.trim().length < 8) return;
    await recordStep(blockedStep, "blocked", blockedNote.trim());
    setBlockedStep(null);
    setBlockedNote("");
  };

  const updateRunbookStep = (index, field, value) =>
    setRunbookForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step,
      ),
    }));

  const createRunbook = async () => {
    const payload = {
      ...runbookForm,
      name: runbookForm.name.trim(),
      description: runbookForm.description.trim(),
      trigger: runbookForm.trigger.trim() || "manual",
      steps: runbookForm.steps.map((step) => ({
        action: step.action.trim() || "review",
        description: step.description.trim(),
      })),
    };
    if (
      !payload.name ||
      !payload.description ||
      payload.steps.some((step) => !step.description)
    ) {
      toast.error(
        "Add a name, purpose, and description for every response step.",
      );
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/remediation-playbooks/create`,
        payload,
        { headers },
      );
      setPlaybooks((current) => [...current, response.data]);
      setCreateOpen(false);
      setRunbookForm(emptyRunbook());
      toast.success("Team response runbook created and audited");
    } catch (error) {
      toast.error(
        error.response?.data?.detail ||
          "Could not create the team response runbook",
      );
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async () => {
    if (!activeSession) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/remediation-playbooks/executions/${activeSession.id}/close`,
        { note: closeNote },
        { headers },
      );
      setSessions((current) =>
        current.map((session) =>
          session.id === response.data.id ? response.data : session,
        ),
      );
      setActiveSession(null);
      setCloseNote("");
      toast.success("Response session closed and recorded in the audit trail");
    } catch (error) {
      toast.error(
        error.response?.data?.detail ||
          "Record every response step before closing",
      );
    } finally {
      setSaving(false);
    }
  };

  const cancelSession = async () => {
    if (!activeSession || cancelReason.trim().length < 8) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/remediation-playbooks/executions/${activeSession.id}/cancel`,
        { reason: cancelReason.trim() },
        { headers },
      );
      const updatedSessions = sessions.map((session) =>
        session.id === response.data.id ? response.data : session,
      );
      setSessions(updatedSessions);
      setActiveSession(
        updatedSessions.find((session) => session.status === "in_progress") ||
          null,
      );
      setCancelOpen(false);
      setCancelReason("");
      toast.success("Response session cancelled with an audit reason");
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not cancel the response session",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  const addressed = activeSession?.steps?.every(
    (step) => step.outcome !== "pending",
  );
  const activeSessions = sessions.filter(
    (session) => session.status === "in_progress",
  );
  const selectedClient = clients.find(
    (client) => client.id === launchForm.client_id,
  );
  const scopedDevices = launchForm.client_id
    ? devices.filter((device) => device.client_id === launchForm.client_id)
    : [];
  const scopedTickets = launchForm.client_id
    ? tickets.filter((ticket) => ticket.client_id === launchForm.client_id)
    : [];
  const completedSteps =
    activeSession?.steps?.filter((step) => step.outcome !== "pending").length ||
    0;
  const totalSteps = activeSession?.steps?.length || 0;
  const responseProgress = totalSteps
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;
  const filteredPlaybooks = playbooks.filter((playbook) => {
    const searchable =
      `${playbook.name || ""} ${playbook.description || ""} ${playbook.trigger || ""}`.toLowerCase();
    const matchesQuery =
      !libraryQuery.trim() ||
      searchable.includes(libraryQuery.trim().toLowerCase());
    const matchesSeverity =
      severityFilter === "all" || playbook.severity === severityFilter;
    const matchesSource =
      sourceFilter === "all" || playbook.source === sourceFilter;
    return matchesQuery && matchesSeverity && matchesSource;
  });
  const filteredSessions = sessions.filter(
    (session) => historyFilter === "all" || session.status === historyFilter,
  );

  return (
    <div className="nx-page-stage space-y-6" data-testid="remediation-playbooks-page">
      <OperationalPageHeader
        eyebrow="Nexus Shield | security operations"
        title="Guided response runbooks"
        description="Technician-confirmed containment checklists with durable audit evidence. Runbooks guide work; they never perform disruptive containment automatically."
        icon={ShieldCheck}
        tone="rose"
        signal={activeSessions.length ? "working" : "healthy"}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing || saving}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              disabled={saving}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New team runbook
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroTile
          label="Available runbooks"
          value={playbooks.length}
          icon={ClipboardCheck}
          glow="sky"
          subtitle="Nexus templates and team guidance"
          animated={false}
        />
        <HeroTile
          label="Active responses"
          value={activeSessions.length || "Clear"}
          icon={Play}
          glow={activeSessions.length ? "amber" : "zinc"}
          subtitle={
            activeSession
              ? `${activeSession.client_name || "Unscoped"} · ${activeSession.playbook_name}`
              : "No guided response in progress"
          }
          animated={Boolean(activeSessions.length)}
        />
        <HeroTile
          label="Closed with evidence"
          value={
            sessions.filter((session) => session.status === "closed").length
          }
          icon={CheckCircle2}
          glow="emerald"
          subtitle={`${sessions.length} total recorded sessions`}
          animated={false}
        />
      </div>

      {loadError && (
        <Card className="border-rose-500/30 bg-rose-500/[0.05]" role="alert">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
              <div>
                <p className="font-medium">Response data is unavailable</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {loadError}. No response actions can be recorded until the
                  workspace reconnects.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {activeSession && (
        <Card
          className="border-primary/40"
          data-testid="active-response-session"
        >
          <CardContent className="space-y-5 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <h2 className="font-semibold">Guided response in progress</h2>
                  <Badge variant="warning">In progress</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeSession.playbook_name}. Confirm each action only after
                  completing it in the authoritative provider or incident
                  workflow.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="border-sky-500/25 text-sky-700 dark:text-sky-100"
                  >
                    <Building2 className="mr-1 h-3 w-3" />
                    {activeSession.client_name || "Legacy unscoped session"}
                  </Badge>
                  {activeSession.device_name && (
                    <Badge
                      variant="outline"
                      className="border-cyan-500/25 text-cyan-700 dark:text-cyan-100"
                    >
                      <Monitor className="mr-1 h-3 w-3" />
                      {activeSession.device_name}
                    </Badge>
                  )}
                  {activeSession.ticket_number && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/25 text-amber-700 dark:text-amber-100"
                    >
                      <TicketCheck className="mr-1 h-3 w-3" />
                      {activeSession.ticket_number}
                    </Badge>
                  )}
                  {activeSession.trigger_reference && (
                    <Badge
                      variant="outline"
                      className="border-violet-500/25 text-violet-700 dark:text-violet-100"
                    >
                      <Link2 className="mr-1 h-3 w-3" />
                      {activeSession.trigger_reference}
                    </Badge>
                  )}
                  <Badge variant="outline">
                    <Clock3 className="mr-1 h-3 w-3" />
                    Started {formatDateTime(activeSession.started_at)}
                  </Badge>
                </div>
                {activeSession.scope_note && (
                  <p className="mt-3 rounded-lg border border-white/[0.08] bg-black/[0.15] px-3 py-2 text-xs text-muted-foreground">
                    <strong className="text-zinc-200">Recorded scope:</strong>{" "}
                    {activeSession.scope_note}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                className="shrink-0 border-rose-500/30 text-rose-100 hover:bg-rose-500/10"
                onClick={() => {
                  setCancelOpen(true);
                  setCancelReason("");
                }}
                disabled={saving}
              >
                <Ban className="mr-1.5 h-4 w-4" />
                Cancel response
              </Button>
            </div>
            {activeSessions.length > 1 && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-white/[0.08] bg-black/[0.12] p-3">
                <span className="mr-1 self-center text-xs font-medium text-muted-foreground">
                  Other active responses:
                </span>
                {activeSessions
                  .filter((session) => session.id !== activeSession.id)
                  .map((session) => (
                    <Button
                      key={session.id}
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveSession(session)}
                    >
                      {session.client_name || "Unscoped"} ·{" "}
                      {session.playbook_name}
                    </Button>
                  ))}
              </div>
            )}
            <div
              className="rounded-xl border border-border/70 bg-muted/20 p-4"
              aria-label={`${responseProgress}% of response steps addressed`}
            >
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Response progress</span>
                <span className="text-muted-foreground">
                  {completedSteps} of {totalSteps} steps · {responseProgress}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${responseProgress}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeSession.device_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(`/devices/${activeSession.device_id}`)
                    }
                  >
                    <Monitor className="mr-1.5 h-4 w-4" />
                    Open managed asset
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                )}
                {activeSession.ticket_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/tickets?ticket=${encodeURIComponent(activeSession.ticket_id)}`,
                      )
                    }
                  >
                    <TicketCheck className="mr-1.5 h-4 w-4" />
                    Open linked ticket
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {activeSession.steps?.map((step) => (
                <div
                  key={step.order}
                  className="rounded-xl border border-border/70 bg-muted/20 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {step.order}
                      </span>
                      <div>
                        <p className="text-sm font-medium">
                          {step.description}
                        </p>
                        {step.recorded_at && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {step.outcome.replace("_", " ")} by{" "}
                            {step.recorded_by}
                          </p>
                        )}
                        {step.note && (
                          <p className="mt-2 rounded-md border border-amber-500/15 bg-amber-500/[0.05] px-2 py-1.5 text-xs text-muted-foreground">
                            Recorded note: {step.note}
                          </p>
                        )}
                      </div>
                    </div>
                    {step.outcome === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={saving}
                          onClick={() => recordStep(step, "completed")}
                        >
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => recordStep(step, "not_applicable")}
                        >
                          N/A
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => {
                            setBlockedStep(step);
                            setBlockedNote("");
                          }}
                        >
                          Blocked
                        </Button>
                      </div>
                    ) : (
                      <Badge
                        variant={
                          step.outcome === "completed" ? "default" : "secondary"
                        }
                      >
                        {step.outcome.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row">
              <Textarea
                value={closeNote}
                onChange={(event) => setCloseNote(event.target.value)}
                placeholder="Optional closure note for the audit record"
                className="min-h-[76px]"
              />
              <Button
                disabled={!addressed || saving}
                onClick={closeSession}
                className="sm:self-end"
              >
                Close response
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Response library</h2>
            <p className="text-sm text-muted-foreground">
              Search approved guidance by scenario, trigger, severity, or
              ownership.
            </p>
          </div>
          <div
            className="grid gap-2 sm:grid-cols-[minmax(15rem,1fr)_9rem_10rem]"
            aria-label="Runbook filters"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search runbooks or triggers"
                className="pl-9"
                aria-label="Search response runbooks"
              />
            </div>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger aria-label="Filter by severity">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ownership</SelectItem>
                <SelectItem value="nexus_template">Nexus templates</SelectItem>
                <SelectItem value="team">Team runbooks</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-4">
          {filteredPlaybooks.map((playbook) => (
            <Card
              key={playbook.id}
              data-testid={`playbook-${playbook.id}`}
              className="overflow-hidden transition-colors hover:border-primary/25"
            >
              <CardContent className="p-0">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{playbook.name}</h3>
                      <Badge
                        variant={
                          severityVariant[playbook.severity] || "secondary"
                        }
                      >
                        {playbook.severity}
                      </Badge>
                      <Badge variant="outline">
                        {playbook.source === "nexus_template"
                          ? "Nexus template"
                          : "Team runbook"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {playbook.description}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Trigger:{" "}
                      <code className="rounded bg-muted px-1 py-0.5">
                        {playbook.trigger}
                      </code>{" "}
                      · {playbook.steps?.length || 0} documented steps
                    </p>
                    <details className="group mt-4 rounded-xl border border-border/60 bg-muted/20">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <span>Review technician checklist</span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <ol className="space-y-2 border-t border-border/60 px-4 py-3">
                        {playbook.steps?.map((step) => (
                          <li key={step.order} className="flex gap-2 text-sm">
                            <span className="font-medium text-primary">
                              {step.order}.
                            </span>
                            <span>{step.description}</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                  <div className="flex border-t border-border/60 p-4 lg:border-l lg:border-t-0">
                    <Button
                      className="w-full shrink-0 lg:w-auto"
                      disabled={
                        saving || !playbook.enabled || Boolean(loadError)
                      }
                      onClick={() => openLaunch(playbook)}
                    >
                      <Play className="mr-1.5 h-4 w-4" />
                      Start guided response
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {!filteredPlaybooks.length && (
            <Card>
              <CardContent className="py-10 text-center">
                <Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
                <p className="font-medium">No matching runbooks</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Clear a filter or create a team runbook for this response
                  scenario.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setLibraryQuery("");
                    setSeverityFilter("all");
                    setSourceFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
      {!sessions.length ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <FileWarning className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            No response sessions have been recorded yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-semibold">Response session history</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every launched, completed, and cancelled response remains
                  attributable to its technician and scope.
                </p>
              </div>
              <Select value={historyFilter} onValueChange={setHistoryFilter}>
                <SelectTrigger
                  className="w-full sm:w-44"
                  aria-label="Filter response history"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sessions</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {filteredSessions.slice(0, 20).map((session) => (
              <div
                key={session.id}
                className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-black/[0.12] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {session.playbook_name}
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        session.status === "closed"
                          ? "border-emerald-500/25 text-emerald-100"
                          : session.status === "cancelled"
                            ? "border-zinc-500/30 text-zinc-300"
                            : "border-amber-500/25 text-amber-100"
                      }
                    >
                      {session.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {session.client_name || "Legacy unscoped session"} · started
                    by {session.started_by}
                  </p>
                  {session.cancel_reason && (
                    <p className="mt-1 text-xs text-zinc-400">
                      Cancellation: {session.cancel_reason}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedHistorySession(session)}
                  >
                    View evidence
                  </Button>
                  {session.status === "in_progress" && (
                    <Button size="sm" onClick={() => setActiveSession(session)}>
                      Open response
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!filteredSessions.length && (
              <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                No {historyFilter.replace("_", " ")} response sessions found.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(launchPlaybook)}
        onOpenChange={(open) => {
          if (!open) {
            setLaunchPlaybook(null);
            setLaunchForm(emptyLaunch());
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-rose-300" />
              Launch guided response
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-rose-100">
                  {launchPlaybook?.name}
                </p>
                <Badge
                  variant={
                    severityVariant[launchPlaybook?.severity] || "secondary"
                  }
                >
                  {launchPlaybook?.severity}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-rose-100/70">
                {launchPlaybook?.description}
              </p>
            </div>
            {launchLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading client response context...
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <InlineRecordPicker
                    id="response-client"
                    label="Client"
                    options={clients}
                    value={launchForm.client_id}
                    onChange={(clientId) =>
                      setLaunchForm((current) => ({
                        ...current,
                        client_id: clientId,
                        device_id: "",
                        ticket_id: "",
                      }))
                    }
                    getLabel={(client) =>
                      client.name || client.company_name || client.id
                    }
                    getDescription={(client) =>
                      client.primary_contact_email || client.email || client.id
                    }
                    placeholder="Search client name or email"
                    emptyText="No matching clients"
                    required
                  />
                  <div>
                    <Label htmlFor="response-trigger-reference">
                      Alert or signal reference
                    </Label>
                    <Input
                      id="response-trigger-reference"
                      className="mt-2"
                      value={launchForm.trigger_reference}
                      onChange={(event) =>
                        setLaunchForm((current) => ({
                          ...current,
                          trigger_reference: event.target.value,
                        }))
                      }
                      placeholder="Canary alert, Defender incident, provider case..."
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Optional provider reference used to correlate the response
                      in activity and audit history.
                    </p>
                  </div>
                  <InlineRecordPicker
                    id="response-device"
                    label="Affected managed asset"
                    options={scopedDevices}
                    value={launchForm.device_id}
                    onChange={(deviceId) =>
                      setLaunchForm((current) => ({
                        ...current,
                        device_id: deviceId,
                      }))
                    }
                    getLabel={(device) =>
                      device.name || device.hostname || device.id
                    }
                    getDescription={(device) =>
                      `${device.os_name || device.os || "Managed asset"} · ${device.status || "Inventory record"}`
                    }
                    placeholder={
                      selectedClient
                        ? "Search this client's managed assets"
                        : "Choose a client first"
                    }
                    emptyText={
                      selectedClient
                        ? "No matching managed assets for this client"
                        : "Choose a client first"
                    }
                    disabled={!selectedClient}
                  />
                  <InlineRecordPicker
                    id="response-ticket"
                    label="Linked ticket or incident"
                    options={scopedTickets}
                    value={launchForm.ticket_id}
                    onChange={(ticketId) =>
                      setLaunchForm((current) => ({
                        ...current,
                        ticket_id: ticketId,
                      }))
                    }
                    getLabel={(ticket) =>
                      `${ticket.ticket_number || ticket.id} · ${ticket.title || ticket.subject || "Untitled ticket"}`
                    }
                    getDescription={(ticket) =>
                      `${ticket.status || "Open"} · ${ticket.priority || "Standard priority"}`
                    }
                    placeholder={
                      selectedClient
                        ? "Search this client's tickets"
                        : "Choose a client first"
                    }
                    emptyText={
                      selectedClient
                        ? "No matching tickets for this client"
                        : "Choose a client first"
                    }
                    disabled={!selectedClient}
                  />
                </div>
                <div>
                  <Label htmlFor="response-scope-note">
                    Observed signal and response scope *
                  </Label>
                  <Textarea
                    id="response-scope-note"
                    className="mt-2"
                    rows={4}
                    value={launchForm.scope_note}
                    onChange={(event) =>
                      setLaunchForm((current) => ({
                        ...current,
                        scope_note: event.target.value,
                      }))
                    }
                    placeholder="Describe what was observed, the confirmed or suspected impact, and what this guided response is authorised to cover."
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    This becomes the opening evidence statement. No containment
                    action is represented as complete until a technician records
                    its step outcome.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setLaunchPlaybook(null);
                setLaunchForm(emptyLaunch());
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={start}
              disabled={
                saving ||
                launchLoading ||
                !launchForm.client_id ||
                launchForm.scope_note.trim().length < 12
              }
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Launch audited response
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) setCancelReason("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-300" />
              Cancel guided response
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Cancellation does not delete the session. Nexus retains who
              launched it, the original scope, pending steps, and your reason so
              the audit trail remains complete.
            </p>
            <div>
              <Label htmlFor="response-cancel-reason">
                Cancellation reason
              </Label>
              <Textarea
                id="response-cancel-reason"
                className="mt-2"
                rows={4}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Example: Opened during a workflow test; no customer incident or containment action occurred."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setCancelOpen(false);
                setCancelReason("");
              }}
              disabled={saving}
            >
              Keep response open
            </Button>
            <Button
              variant="destructive"
              onClick={cancelSession}
              disabled={saving || cancelReason.trim().length < 8}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Cancel and retain audit
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setRunbookForm(emptyRunbook());
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-sky-300" />
              Create team response runbook
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            <p className="text-sm text-muted-foreground">
              Build technician-led guidance for an agreed response. Every
              recorded action is attributed to the acting technician and
              retained in the audit trail.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="runbook-name">Runbook name</Label>
                <Input
                  id="runbook-name"
                  className="mt-1"
                  value={runbookForm.name}
                  onChange={(event) =>
                    setRunbookForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Example: Lost device response"
                />
              </div>
              <div>
                <Label htmlFor="runbook-severity">Severity</Label>
                <Select
                  value={runbookForm.severity}
                  onValueChange={(severity) =>
                    setRunbookForm((current) => ({ ...current, severity }))
                  }
                >
                  <SelectTrigger id="runbook-severity" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="runbook-purpose">Purpose and scope</Label>
              <Textarea
                id="runbook-purpose"
                className="mt-1"
                rows={3}
                value={runbookForm.description}
                onChange={(event) =>
                  setRunbookForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Describe when technicians should use this runbook and what it protects."
              />
            </div>
            <div>
              <Label htmlFor="runbook-trigger">Trigger or signal</Label>
              <Input
                id="runbook-trigger"
                className="mt-1"
                value={runbookForm.trigger}
                onChange={(event) =>
                  setRunbookForm((current) => ({
                    ...current,
                    trigger: event.target.value,
                  }))
                }
                placeholder="Example: lost_or_stolen_device"
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Response steps</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Write specific, technician-verifiable actions. Steps are
                    never executed automatically.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setRunbookForm((current) => ({
                      ...current,
                      steps: [
                        ...current.steps,
                        { action: "review", description: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add step
                </Button>
              </div>
              {runbookForm.steps.map((step, index) => (
                <div
                  key={`step-${index}`}
                  className="grid gap-2 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[11rem_1fr_auto]"
                >
                  <Input
                    value={step.action}
                    onChange={(event) =>
                      updateRunbookStep(index, "action", event.target.value)
                    }
                    aria-label={`Action for step ${index + 1}`}
                    placeholder="Action key"
                  />
                  <Input
                    value={step.description}
                    onChange={(event) =>
                      updateRunbookStep(
                        index,
                        "description",
                        event.target.value,
                      )
                    }
                    aria-label={`Description for step ${index + 1}`}
                    placeholder={`Step ${index + 1} description`}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={runbookForm.steps.length === 1}
                    onClick={() =>
                      setRunbookForm((current) => ({
                        ...current,
                        steps: current.steps.filter(
                          (_, stepIndex) => stepIndex !== index,
                        ),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={createRunbook} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create audited runbook
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedHistorySession)}
        onOpenChange={(open) => {
          if (!open) setSelectedHistorySession(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-emerald-500" />
              Response evidence record
            </DialogTitle>
          </DialogHeader>
          {selectedHistorySession && (
            <div className="space-y-5">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    {selectedHistorySession.playbook_name}
                  </p>
                  <Badge variant="outline">
                    {selectedHistorySession.status.replace("_", " ")}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedHistorySession.client_name ||
                    "Legacy unscoped session"}{" "}
                  · started by {selectedHistorySession.started_by} on{" "}
                  {formatDateTime(selectedHistorySession.started_at)}
                </p>
                {selectedHistorySession.scope_note && (
                  <p className="mt-3 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm">
                    <span className="font-medium">Recorded scope:</span>{" "}
                    {selectedHistorySession.scope_note}
                  </p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Managed asset
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {selectedHistorySession.device_name || "Not linked"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Ticket / incident
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {selectedHistorySession.ticket_number || "Not linked"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Signal reference
                  </p>
                  <p className="mt-1 break-words text-sm font-medium">
                    {selectedHistorySession.trigger_reference || "Not recorded"}
                  </p>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">
                  Recorded response steps
                </h3>
                <div className="mt-3 space-y-2">
                  {selectedHistorySession.steps?.map((step) => (
                    <div
                      key={step.order}
                      className="flex gap-3 rounded-xl border border-border/70 p-3"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {step.order}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {step.description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {step.outcome?.replace("_", " ") || "pending"}
                          {step.recorded_by ? ` by ${step.recorded_by}` : ""}
                          {step.recorded_at
                            ? ` · ${formatDateTime(step.recorded_at)}`
                            : ""}
                        </p>
                        {step.note && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Note: {step.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {(selectedHistorySession.close_note ||
                selectedHistorySession.cancel_reason) && (
                <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm">
                  <span className="font-medium">
                    {selectedHistorySession.status === "cancelled"
                      ? "Cancellation reason"
                      : "Closure note"}
                    :
                  </span>{" "}
                  {selectedHistorySession.cancel_reason ||
                    selectedHistorySession.close_note}
                </div>
              )}
              <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
                <div className="flex flex-wrap gap-2">
                  {selectedHistorySession.device_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(`/devices/${selectedHistorySession.device_id}`)
                      }
                    >
                      <Monitor className="mr-1.5 h-4 w-4" />
                      Open asset
                    </Button>
                  )}
                  {selectedHistorySession.ticket_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(
                          `/tickets?ticket=${encodeURIComponent(selectedHistorySession.ticket_id)}`,
                        )
                      }
                    >
                      <TicketCheck className="mr-1.5 h-4 w-4" />
                      Open ticket
                    </Button>
                  )}
                </div>
                <Button onClick={() => setSelectedHistorySession(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(blockedStep)}
        onOpenChange={(open) => {
          if (!open) {
            setBlockedStep(null);
            setBlockedNote("");
          }
        }}
      >
        <NexusWorkflowDialog
          eyebrow="Response evidence"
          title="Record blocked response step"
          description="Explain what prevented the action and who owns the next step. This evidence becomes part of the immutable response record."
          icon={Ban}
          tone="amber"
          footer={
            <>
              <Button variant="outline" onClick={() => { setBlockedStep(null); setBlockedNote(""); }} disabled={saving}>Cancel</Button>
              <Button variant="destructive" onClick={submitBlockedStep} disabled={saving || blockedNote.trim().length < 8}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Record blocked step</Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-muted-foreground">Document the blocker, the agreed next step, the owner, and the expected timing. This gives the next technician a complete handover.</div>
            <Textarea
              value={blockedNote}
              onChange={(event) => setBlockedNote(event.target.value)}
              rows={4}
              placeholder="Example: Endpoint was powered off; client contact requested a scheduled onsite visit. Assigned to Jordan for 09:00 tomorrow."
            />
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
