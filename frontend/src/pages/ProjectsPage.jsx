import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FolderKanban,
  Gauge,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

const PROJECT_STATUSES = {
  planning: { label: "Planning", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-200" },
  in_progress: { label: "In progress", className: "border-sky-500/30 bg-sky-500/10 text-sky-200" },
  on_hold: { label: "On hold", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  completed: { label: "Completed", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
  cancelled: { label: "Cancelled", className: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
};

const TASK_STATUSES = {
  todo: { label: "To do", dot: "bg-zinc-400" },
  in_progress: { label: "In progress", dot: "bg-sky-400" },
  review: { label: "Review", dot: "bg-amber-400" },
  completed: { label: "Completed", dot: "bg-emerald-400" },
};

const PRIORITY_STYLES = {
  low: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  medium: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  high: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  urgent: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

const EMPTY_PROJECT = {
  name: "",
  description: "",
  client_id: "",
  status: "planning",
  priority: "medium",
  start_date: "",
  target_end_date: "",
  budget_hours: "",
  project_manager: "",
};

const EMPTY_TASK = {
  title: "",
  description: "",
  status: "todo",
  priority: "medium",
  assigned_to: "",
  estimated_hours: "",
  due_date: "",
  ticket_id: "",
  blocker_reason: "",
};

const label = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const compactDate = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Not scheduled";
const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not recorded";
const isOverdue = (project) => Boolean(project.target_end_date && !["completed", "cancelled"].includes(project.status) && new Date(`${project.target_end_date}T23:59:59`) < new Date());
const projectProgress = (project) => {
  if (!project.budget_hours) return 0;
  return Math.min(100, Math.round(((project.spent_hours || 0) / project.budget_hours) * 100));
};
const ticketLabel = (ticket) => [ticket.ticket_number ? `#${ticket.ticket_number}` : "Ticket", ticket.title].filter(Boolean).join(" - ");

function TicketPlanRow({ plan }) {
  const isProvisioning = plan.status === "provisioning";
  const isFailed = plan.status === "failed";
  const total = Number(plan.delivery_summary?.total ?? plan.child_ticket_count ?? 0);
  const completed = Number(plan.delivery_summary?.completed || 0);
  const progress = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`project-ticket-plan-${plan.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{plan.blueprint_name}</p>
          {isFailed ? (
            <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 text-[9px] text-rose-100">
              <AlertTriangle className="mr-1 h-3 w-3" />Needs attention
            </Badge>
          ) : isProvisioning ? (
            <Badge variant="outline" className="border-sky-400/30 bg-sky-400/10 text-[9px] text-sky-100">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />Provisioning ticket tree
            </Badge>
          ) : (
            <Badge variant="outline" className={plan.delivery_summary?.active ? "border-amber-400/30 bg-amber-400/10 text-[9px] text-amber-100" : "border-emerald-400/30 bg-emerald-400/10 text-[9px] text-emerald-100"}>
              {completed}/{total} child tickets resolved
            </Badge>
          )}
          {!isFailed && Boolean(plan.delivery_summary?.ready_for_review) && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[9px] text-amber-100">{plan.delivery_summary.ready_for_review} ready for review</Badge>
          )}
          {!isFailed && Boolean(plan.delivery_summary?.independently_verified) && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-[9px] text-emerald-100">{plan.delivery_summary.independently_verified} independently verified</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono text-sky-200">{plan.parent_ticket_number}</span>
          {isFailed
            ? " · The ticket tree did not finish provisioning. Nexus has blocked duplicate generation."
            : isProvisioning
              ? " · Building linked work tickets"
              : ` · ${total} linked child ticket${total === 1 ? "" : "s"}`}
          {!isFailed && plan.delivery_summary?.last_ticket_update ? ` · updated ${dateTime(plan.delivery_summary.last_ticket_update)}` : ""}
        </p>
        {!isFailed && (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted/70">
            <div className="bg-emerald-400 transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {plan.parent_ticket_id && (
        <a className="text-xs font-medium text-sky-200 hover:text-sky-100 hover:underline" href={`/tickets?ticket=${encodeURIComponent(plan.parent_ticket_id)}`}>
          {isFailed ? "Review parent ticket" : "Open parent ticket"}
        </a>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [searchParams, setSearchParams] = useSearchParams();
  const handledProjectLink = useRef(null);
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [projectTemplates, setProjectTemplates] = useState([]);
  const [ticketBlueprints, setTicketBlueprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectDialog, setProjectDialog] = useState(null);
  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT);
  const [clientQuery, setClientQuery] = useState("");
  const [managerQuery, setManagerQuery] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [projectActivity, setProjectActivity] = useState([]);
  const [projectTicketPlans, setProjectTicketPlans] = useState([]);
  const [governance, setGovernance] = useState(null);
  const [timeSummary, setTimeSummary] = useState(null);
  const [clientTickets, setClientTickets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [taskDialog, setTaskDialog] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [decisionDialog, setDecisionDialog] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ title: "", detail: "" });
  const [scopeDialog, setScopeDialog] = useState(false);
  const [scopeDraft, setScopeDraft] = useState([]);
  const [reviewTask, setReviewTask] = useState(null);
  const [reviewForm, setReviewForm] = useState({ result: "verified", notes: "" });
  const [decisionToResolve, setDecisionToResolve] = useState(null);
  const [resolution, setResolution] = useState("");
  const [closeoutDialog, setCloseoutDialog] = useState(false);
  const [closeoutNotes, setCloseoutNotes] = useState({});
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "" });
  const [ticketPlanDialog, setTicketPlanDialog] = useState(false);
  const [ticketPlanForm, setTicketPlanForm] = useState({ blueprint_id: "", title: "", description: "" });
  const [launchingTicketPlan, setLaunchingTicketPlan] = useState(false);

  const fetchData = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [projectsResponse, clientsResponse, usersResponse, templatesResponse, ticketBlueprintsResponse] = await Promise.all([
        axios.get(`${API}/projects`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/project-templates`, { headers }),
        axios.get(`${API}/blueprints?active_only=true`, { headers }),
      ]);
      setProjects(projectsResponse.data || []);
      setClients(clientsResponse.data || []);
      setUsers(usersResponse.data || []);
      setProjectTemplates(templatesResponse.data || []);
      setTicketBlueprints(ticketBlueprintsResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Projects could not be loaded");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openProject = async (project) => {
    setSelectedProject(project);
    setDetailLoading(true);
    setProjectTasks([]);
    setProjectActivity([]);
    setProjectTicketPlans([]);
    setGovernance(null);
    setTimeSummary(null);
    try {
      const requests = [
        axios.get(`${API}/projects/${project.id}/tasks`, { headers }),
        axios.get(`${API}/projects/${project.id}/time-summary`, { headers }),
        axios.get(`${API}/projects/${project.id}/activity`, { headers }),
        axios.get(`${API}/projects/${project.id}/governance`, { headers }),
        axios.get(`${API}/projects/${project.id}/ticket-plans`, { headers }),
      ];
      if (project.client_id) requests.push(axios.get(`${API}/tickets?client_id=${project.client_id}`, { headers }));
      const [tasksResponse, summaryResponse, activityResponse, governanceResponse, ticketPlansResponse, ticketsResponse] = await Promise.all(requests);
      setProjectTasks(tasksResponse.data || []);
      setTimeSummary(summaryResponse.data || null);
      setProjectActivity(activityResponse.data || []);
      setGovernance(governanceResponse.data || null);
      setProjectTicketPlans(ticketPlansResponse.data || []);
      setClientTickets(ticketsResponse?.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Project delivery details could not be loaded");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeProjectDialog = () => {
    setProjectDialog(null);
    setProjectForm(EMPTY_PROJECT);
    setClientQuery("");
    setManagerQuery("");
    setProjectTemplateId("");
  };

  const openNewProject = () => {
    setProjectForm(EMPTY_PROJECT);
    setClientQuery("");
    setManagerQuery("");
    setProjectTemplateId("");
    setProjectDialog({ mode: "create" });
  };

  const openEditProject = (project) => {
    setProjectForm({
      name: project.name || "",
      description: project.description || "",
      client_id: project.client_id || "",
      status: project.status || "planning",
      priority: project.priority || "medium",
      start_date: project.start_date || "",
      target_end_date: project.target_end_date || "",
      budget_hours: project.budget_hours ?? "",
      project_manager: project.project_manager || "",
    });
    setClientQuery(project.client_name || "");
    setManagerQuery(project.project_manager_name || "");
    setProjectTemplateId("");
    setSelectedProject(null);
    setProjectDialog({ mode: "edit", project });
  };

  const chooseClient = (value) => {
    const match = clients.find((client) => client.name.toLowerCase() === value.trim().toLowerCase());
    setClientQuery(value);
    setProjectForm((current) => ({ ...current, client_id: match?.id || "" }));
  };

  const chooseManager = (value) => {
    const match = users.find((user) => user.name.toLowerCase() === value.trim().toLowerCase());
    setManagerQuery(value);
    setProjectForm((current) => ({ ...current, project_manager: match?.id || "" }));
  };

  const saveProject = async (event) => {
    event.preventDefault();
    if (!projectForm.client_id) {
      toast.error("Select a client from the suggested matches before saving.");
      return;
    }
    if (!projectForm.project_manager) {
      toast.error("Assign a Project Manager before saving this project.");
      return;
    }
    setSavingProject(true);
    try {
      const payload = {
        ...projectForm,
        budget_hours: projectForm.budget_hours === "" ? null : Number(projectForm.budget_hours),
      };
      if (projectDialog?.mode === "edit") {
        await axios.put(`${API}/projects/${projectDialog.project.id}`, payload, { headers });
        toast.success("Project updated and recorded in the activity trail");
      } else if (projectTemplateId) {
        const response = await axios.post(`${API}/projects/from-template`, { template_id: projectTemplateId, project: payload }, { headers });
        toast.success(`${response.data?.template_name || "Project template"} applied with ${response.data?.tasks || 0} delivery tasks`);
      } else {
        await axios.post(`${API}/projects`, payload, { headers });
        toast.success("Project created");
      }
      closeProjectDialog();
      await fetchData({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Project could not be saved");
    } finally {
      setSavingProject(false);
    }
  };

  const deleteProject = async (project, confirmed = false) => {
    if (!confirmed) {
      setDeleteTarget({ type: "project", item: project });
      return;
    }
    try {
      await axios.delete(`${API}/projects/${project.id}`, { headers });
      toast.success("Project deleted");
      setSelectedProject(null);
      setDeleteTarget(null);
      await fetchData({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Project could not be deleted");
    }
  };

  // Project-linked tickets can return a technician directly to the delivery
  // plan without asking them to search the project board first.
  useEffect(() => {
    const projectId = searchParams.get("project");
    if (!projectId || !projects.length || handledProjectLink.current === projectId) return;
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    handledProjectLink.current = projectId;
    openProject(project);
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    setSearchParams(next, { replace: true });
    // openProject is intentionally invoked only for an explicit deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, searchParams, setSearchParams]);

  // A completed project child ticket can hand the next technician directly to
  // the independent review, while the API remains the authority for who may
  // approve it.
  useEffect(() => {
    const taskId = searchParams.get("review_task");
    if (!taskId || !selectedProject || detailLoading) return;
    const task = projectTasks.find((item) => item.id === taskId);
    if (!task || task.status !== "review") return;
    setReviewTask(task);
    setReviewForm({ result: "verified", notes: "" });
    const next = new URLSearchParams(searchParams);
    next.delete("review_task");
    setSearchParams(next, { replace: true });
  }, [detailLoading, projectTasks, searchParams, selectedProject, setSearchParams]);

  const chooseProjectTemplate = (templateId) => {
    setProjectTemplateId(templateId);
    const template = projectTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setProjectForm((current) => ({
      ...current,
      description: current.description || template.description || "",
      priority: template.priority || current.priority,
    }));
  };

  const raiseDecision = async () => {
    if (!selectedProject) return;
    if (decisionForm.title.trim().length < 3) { toast.error("Describe the Project Manager decision required."); return; }
    try {
      await axios.post(`${API}/projects/${selectedProject.id}/decisions`, decisionForm, { headers });
      toast.success("Project Manager decision raised");
      setDecisionDialog(false);
      setDecisionForm({ title: "", detail: "" });
      await openProject(selectedProject);
    } catch (error) { toast.error(error.response?.data?.detail || "Decision could not be raised"); }
  };

  const openScopeDialog = () => {
    setScopeDraft((governance?.scope || []).map((item) => ({ component: item.component || "", state: item.state || "required", notes: item.notes || "" })));
    setScopeDialog(true);
  };

  const saveScope = async () => {
    if (!selectedProject) return;
    const items = scopeDraft.filter((item) => item.component.trim());
    if (!items.length) {
      toast.error("Add at least one scoped implementation component.");
      return;
    }
    try {
      await axios.put(`${API}/projects/${selectedProject.id}/scope`, { items }, { headers });
      toast.success("Authoritative project scope saved");
      setScopeDialog(false);
      await reloadProjectDetail();
    } catch (error) { toast.error(error.response?.data?.detail || "Project scope could not be saved"); }
  };

  const resolveDecision = async () => {
    if (!selectedProject || !decisionToResolve) return;
    if (resolution.trim().length < 3) { toast.error("Record the accountable decision resolution."); return; }
    try {
      await axios.post(`${API}/projects/${selectedProject.id}/decisions/${decisionToResolve.id}/resolve`, { resolution }, { headers });
      toast.success("Project Manager decision resolved");
      setDecisionToResolve(null);
      setResolution("");
      await reloadProjectDetail();
    } catch (error) { toast.error(error.response?.data?.detail || "Decision could not be resolved"); }
  };

  const submitTaskReview = async () => {
    if (!selectedProject || !reviewTask) return;
    if (reviewForm.result === "changes_requested" && reviewForm.notes.trim().length < 3) {
      toast.error("Explain what must change before returning the work.");
      return;
    }
    try {
      await axios.post(`${API}/projects/${selectedProject.id}/tasks/${reviewTask.id}/review`, reviewForm, { headers });
      toast.success(reviewForm.result === "verified" ? "Independent review recorded" : "Changes requested and work returned");
      setReviewTask(null);
      setReviewForm({ result: "verified", notes: "" });
      await reloadProjectDetail();
    } catch (error) { toast.error(error.response?.data?.detail || "Task review could not be recorded"); }
  };

  const saveCloseoutCheck = async (check, completed) => {
    if (!selectedProject) return;
    try {
      await axios.put(`${API}/projects/${selectedProject.id}/closeout-checks/${check}`, { completed, notes: closeoutNotes[check] || "" }, { headers });
      toast.success(`${label(check)} marked ${completed ? "complete" : "incomplete"}`);
      await reloadProjectDetail();
    } catch (error) { toast.error(error.response?.data?.detail || "Close-out check could not be updated"); }
  };

  const openTemplateDialog = () => {
    if (!selectedProject) return;
    setTemplateForm({ name: `${selectedProject.name} standard`, description: selectedProject.description || "" });
    setTemplateDialog(true);
  };

  const publishProjectTemplate = async () => {
    if (!selectedProject || templateForm.name.trim().length < 3) {
      toast.error("Give the reusable delivery template a clear name.");
      return;
    }
    try {
      const response = await axios.post(`${API}/projects/${selectedProject.id}/save-as-template`, templateForm, { headers });
      setProjectTemplates((current) => [...current.filter((item) => item.id !== response.data.id), response.data].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateDialog(false);
      toast.success("Reusable project template published");
      await reloadProjectDetail();
    } catch (error) { toast.error(error.response?.data?.detail || "Project template could not be published"); }
  };

  const openTicketPlanDialog = () => {
    if (!selectedProject) return;
    setTicketPlanForm({ blueprint_id: "", title: `${selectedProject.name} delivery`, description: selectedProject.description || "" });
    setTicketPlanDialog(true);
  };

  const launchTicketPlan = async () => {
    if (!selectedProject || !ticketPlanForm.blueprint_id) {
      toast.error("Select the ticket blueprint that defines the parent and child work.");
      return;
    }
    setLaunchingTicketPlan(true);
    try {
      const response = await axios.post(`${API}/projects/${selectedProject.id}/ticket-plans`, ticketPlanForm, { headers });
      const plan = response.data?.plan;
      toast.success(response.data?.idempotent ? "That project ticket plan already exists" : `Created ${plan?.parent_ticket_number || "parent ticket"} and ${plan?.child_ticket_count || 0} child ticket(s)`);
      setTicketPlanDialog(false);
      await reloadProjectDetail();
    } catch (error) { toast.error(error.response?.data?.detail || "Project ticket plan could not be launched"); }
    finally { setLaunchingTicketPlan(false); }
  };

  const openTaskDialog = (task = null) => {
    if (!selectedProject) return;
    setTaskForm({
      title: task?.title || "",
      description: task?.description || "",
      status: task?.status || "todo",
      priority: task?.priority || "medium",
      assigned_to: task?.assigned_to || "",
      estimated_hours: task?.estimated_hours ?? "",
      due_date: task?.due_date || "",
      ticket_id: task?.ticket_id || "",
      blocker_reason: task?.blocker_reason || "",
    });
    setAssigneeQuery(task?.assigned_name || "");
    const matchingTicket = clientTickets.find((ticket) => ticket.id === task?.ticket_id);
    setTicketQuery(task?.ticket_title ? ticketLabel({ ...matchingTicket, ...task }) : matchingTicket ? ticketLabel(matchingTicket) : "");
    setTaskDialog({ mode: task ? "edit" : "create", task });
  };

  const chooseAssignee = (value) => {
    const match = users.find((user) => user.name.toLowerCase() === value.trim().toLowerCase());
    setAssigneeQuery(value);
    setTaskForm((current) => ({ ...current, assigned_to: match?.id || "" }));
  };

  const chooseTicket = (value) => {
    const match = clientTickets.find((ticket) => ticketLabel(ticket).toLowerCase() === value.trim().toLowerCase());
    setTicketQuery(value);
    setTaskForm((current) => ({ ...current, ticket_id: match?.id || "" }));
  };

  const reloadProjectDetail = async () => {
    if (!selectedProject) return;
    await openProject(selectedProject);
    await fetchData({ quiet: true });
  };

  const saveTask = async (event) => {
    event.preventDefault();
    if (!selectedProject) return;
    setSavingTask(true);
    try {
      const payload = {
        ...taskForm,
        estimated_hours: taskForm.estimated_hours === "" ? null : Number(taskForm.estimated_hours),
      };
      if (taskDialog?.mode === "edit") {
        await axios.put(`${API}/projects/${selectedProject.id}/tasks/${taskDialog.task.id}`, payload, { headers });
        toast.success("Task updated and audited");
      } else {
        await axios.post(`${API}/projects/${selectedProject.id}/tasks`, payload, { headers });
        toast.success("Project task created");
      }
      setTaskDialog(null);
      await reloadProjectDetail();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Task could not be saved");
    } finally {
      setSavingTask(false);
    }
  };

  const updateTaskStatus = async (task, status) => {
    if (!selectedProject || task.status === status) return;
    const nextStatus = status === "completed" ? "review" : status;
    try {
      await axios.put(`${API}/projects/${selectedProject.id}/tasks/${task.id}`, { status: nextStatus }, { headers });
      toast.success(nextStatus === "review" ? `${task.title} is ready for independent review` : `${task.title} moved to ${TASK_STATUSES[nextStatus].label}`);
      await reloadProjectDetail();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Task status could not be updated");
    }
  };

  const deleteTask = async (task, confirmed = false) => {
    if (!selectedProject) return;
    if (!confirmed) {
      setDeleteTarget({ type: "task", item: task });
      return;
    }
    try {
      await axios.delete(`${API}/projects/${selectedProject.id}/tasks/${task.id}`, { headers });
      toast.success("Task deleted");
      setDeleteTarget(null);
      await reloadProjectDetail();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Task could not be deleted");
    }
  };

  const filteredProjects = projects.filter((project) => {
    const haystack = [project.name, project.client_name, project.project_manager_name, project.description].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(searchQuery.toLowerCase()) && (statusFilter === "all" || project.status === statusFilter);
  });
  const metrics = useMemo(() => ({
    total: projects.length,
    active: projects.filter((project) => project.status === "in_progress").length,
    attention: projects.filter((project) => project.status === "on_hold" || isOverdue(project)).length,
    completedTasks: projects.reduce((total, project) => total + (project.completed_task_count || 0), 0),
    totalTasks: projects.reduce((total, project) => total + (project.task_count || 0), 0),
    budget: projects.reduce((total, project) => total + (Number(project.budget_hours) || 0), 0),
  }), [projects]);

  return (
    <div className="space-y-6" data-testid="projects-page">
      <OperationalPageHeader
        eyebrow="Client delivery · scoped work and accountable outcomes"
        title="Projects"
        description="Plan client delivery, make task ownership visible, link work to service tickets, and retain a project-level activity record."
        icon={FolderKanban}
        tone="violet"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => fetchData({ quiet: true })} disabled={refreshing} data-testid="refresh-projects-btn">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={openNewProject} data-testid="create-project-btn"><Plus className="mr-1.5 h-4 w-4" />New project</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <HeroTile label="All projects" value={metrics.total} icon={FolderKanban} glow="violet" subtitle="Client delivery records" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} testId="projects-metric-total" />
        <HeroTile label="In delivery" value={metrics.active} icon={Gauge} glow="sky" subtitle="Work actively progressing" active={statusFilter === "in_progress"} onClick={() => setStatusFilter("in_progress")} testId="projects-metric-active" />
        <HeroTile label="Needs attention" value={metrics.attention} icon={AlertTriangle} glow={metrics.attention ? "amber" : "zinc"} subtitle="On hold or past target" active={statusFilter === "on_hold"} onClick={() => setStatusFilter("on_hold")} testId="projects-metric-attention" />
        <HeroTile label="Tasks delivered" value={metrics.completedTasks} icon={CheckCircle2} glow="emerald" subtitle={`${metrics.totalTasks} total project tasks`} testId="projects-metric-tasks" />
        <HeroTile label="Planned hours" value={metrics.budget} icon={Clock3} glow="indigo" suffix="h" subtitle="Configured project capacity" testId="projects-metric-budget" />
      </div>

      <Card className="border-border/80 bg-card/80"><CardContent className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-9" placeholder="Search project, client, delivery lead or scope…" data-testid="projects-search" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All project statuses</SelectItem>
              {Object.entries(PROJECT_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardContent></Card>

      {loading ? (
        <div className="flex h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : filteredProjects.length === 0 ? (
        <Card><CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center"><FolderKanban className="mb-3 h-10 w-10 text-muted-foreground/45" /><h2 className="text-base font-semibold">No projects match this view</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Create a scoped delivery record to coordinate client work, ownership and ticket-linked tasks.</p><Button className="mt-5" onClick={openNewProject}><Plus className="mr-1.5 h-4 w-4" />Create project</Button></CardContent></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredProjects.map((project) => {
            const progress = projectProgress(project);
            const overdue = isOverdue(project);
            return (
              <Card key={project.id} className="group cursor-pointer border-border/80 transition-all hover:-translate-y-0.5 hover:border-violet-400/45 hover:shadow-lg hover:shadow-violet-950/20" onClick={() => openProject(project)} data-testid={`project-card-${project.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">{project.client_name || "Client not assigned"}</p>
                      <h2 className="mt-1 truncate text-base font-semibold group-hover:text-violet-200">{project.name}</h2>
                      <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description || "No project brief recorded yet."}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); openEditProject(project); }}><Pencil className="mr-2 h-4 w-4" />Edit project</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(event) => { event.stopPropagation(); deleteProject(project); }}><Trash2 className="mr-2 h-4 w-4" />Delete project</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline" className={`text-[10px] ${PROJECT_STATUSES[project.status]?.className || ""}`}>{PROJECT_STATUSES[project.status]?.label || label(project.status)}</Badge>
                    <Badge variant="outline" className={`text-[10px] ${PRIORITY_STYLES[project.priority] || ""}`}>{label(project.priority)} priority</Badge>
                    {overdue && <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200">Target overdue</Badge>}
                  </div>

                  <div className="mt-4 grid gap-3 border-y border-border/70 py-3 sm:grid-cols-2">
                    <div className="flex items-center gap-2 text-xs"><ListChecks className="h-3.5 w-3.5 text-violet-300" /><span className="text-muted-foreground">Delivery</span><span className="ml-auto font-medium">{project.completed_task_count || 0}/{project.task_count || 0} tasks</span></div>
                    <div className="flex items-center gap-2 text-xs"><UserRound className="h-3.5 w-3.5 text-sky-300" /><span className="text-muted-foreground">Lead</span><span className="ml-auto truncate font-medium">{project.project_manager_name || "Unassigned"}</span></div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div><div className="mb-1 flex justify-between text-[11px]"><span className="text-muted-foreground">Budget consumption</span><span>{project.budget_hours ? `${project.spent_hours || 0}h / ${project.budget_hours}h` : "Not budgeted"}</span></div><Progress value={progress} className="h-1.5" /></div>
                    <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />Target</span><span className={overdue ? "font-medium text-rose-300" : "font-medium"}>{compactDate(project.target_end_date)}</span></div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(projectDialog)} onOpenChange={(open) => !open && closeProjectDialog()}>
        <NexusWorkflowDialog
          eyebrow="Project delivery"
          title={projectDialog?.mode === "edit" ? "Update project record" : "Create delivery project"}
          description="Capture the client scope, accountable delivery lead, dates and the capacity you intend to deliver."
          icon={FolderKanban}
          tone="violet"
          className="h-[min(860px,calc(100vh-1.5rem))] max-w-3xl"
          data-testid="project-form-dialog"
          footer={<>
            <Button type="button" variant="outline" onClick={closeProjectDialog} disabled={savingProject}>Cancel</Button>
            <Button type="submit" form="project-authoring-form" disabled={savingProject}>{savingProject && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{projectDialog?.mode === "edit" ? "Save project" : "Create project"}</Button>
          </>}
        >
          <form id="project-authoring-form" onSubmit={saveProject} className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Label htmlFor="project-name">Project name</Label><Input id="project-name" className="mt-1" required minLength={3} value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. M365 tenant migration" /></div>
              {projectDialog?.mode === "create" && <div className="md:col-span-2"><Label>Guided delivery blueprint <span className="font-normal text-muted-foreground">(optional)</span></Label><Select value={projectTemplateId || "__custom"} onValueChange={(value) => chooseProjectTemplate(value === "__custom" ? "" : value)}><SelectTrigger className="mt-1"><SelectValue placeholder="Start from a standard project plan" /></SelectTrigger><SelectContent><SelectItem value="__custom">Custom project — start with a blank scope</SelectItem>{projectTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[11px] text-muted-foreground">A blueprint adds its authoritative scope and delivery tasks after the Project Manager creates this project.</p></div>}
              <div><Label htmlFor="project-client">Client</Label><Input id="project-client" list="project-client-options" className="mt-1" required value={clientQuery} onChange={(event) => chooseClient(event.target.value)} placeholder="Type to find a client" /><datalist id="project-client-options">{clients.map((client) => <option key={client.id} value={client.name} />)}</datalist><p className="mt-1 text-[11px] text-muted-foreground">Select a suggested client so the project and linked tickets stay in the same account.</p></div>
              <div><Label htmlFor="project-manager">Delivery lead</Label><Input id="project-manager" list="project-manager-options" className="mt-1" value={managerQuery} onChange={(event) => chooseManager(event.target.value)} placeholder="Type to assign a lead" /><datalist id="project-manager-options">{users.map((user, index) => <option key={`${user.id}-${index}`} value={user.name} />)}</datalist></div>
              <div className="md:col-span-2"><Label htmlFor="project-description">Project brief</Label><Textarea id="project-description" className="mt-1" rows={4} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} placeholder="Define the client outcome, scope boundaries, delivery assumptions and handover expectations." /></div>
              <div><Label>Status</Label><Select value={projectForm.status} onValueChange={(value) => setProjectForm((current) => ({ ...current, status: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PROJECT_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Priority</Label><Select value={projectForm.priority} onValueChange={(value) => setProjectForm((current) => ({ ...current, priority: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high", "urgent"].map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="project-start-date">Start date</Label><Input id="project-start-date" className="mt-1" type="date" value={projectForm.start_date} onChange={(event) => setProjectForm((current) => ({ ...current, start_date: event.target.value }))} /></div>
              <div><Label htmlFor="project-target-date">Target completion</Label><Input id="project-target-date" className="mt-1" type="date" value={projectForm.target_end_date} onChange={(event) => setProjectForm((current) => ({ ...current, target_end_date: event.target.value }))} /></div>
              <div><Label htmlFor="project-budget-hours">Planned hours</Label><Input id="project-budget-hours" className="mt-1" min="0" step="0.25" type="number" value={projectForm.budget_hours} onChange={(event) => setProjectForm((current) => ({ ...current, budget_hours: event.target.value }))} placeholder="e.g. 36" /></div>
          </form>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(selectedProject)} onOpenChange={(open) => !open && setSelectedProject(null)}>
        <DialogContent className="flex h-[min(920px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl" data-testid="project-detail-dialog">
          {selectedProject && <>
            <DialogHeader className="shrink-0 border-b border-border/80 bg-gradient-to-r from-violet-400/15 via-violet-400/[0.04] to-transparent px-5 py-5 pr-12 md:px-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">{selectedProject.client_name || "Client delivery"}</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl"><FolderKanban className="h-5 w-5 text-violet-300" />{selectedProject.name}</DialogTitle><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{selectedProject.description || "No project brief has been recorded."}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Badge variant="outline" className={PROJECT_STATUSES[selectedProject.status]?.className}>{PROJECT_STATUSES[selectedProject.status]?.label || label(selectedProject.status)}</Badge><Button variant="outline" size="sm" onClick={() => openEditProject(selectedProject)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteProject(selectedProject)}><Trash2 className="h-3.5 w-3.5" /></Button></div></div></DialogHeader>
            {detailLoading ? <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div> : <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ProjectSignal icon={Target} label="Task completion" value={`${timeSummary?.completed_tasks || 0}/${timeSummary?.total_tasks || 0}`} detail={`${timeSummary?.completion_pct || 0}% delivery complete`} tone="violet" />
                <ProjectSignal icon={Clock3} label="Planned capacity" value={`${timeSummary?.estimated_hours || 0}h`} detail={`${selectedProject.budget_hours || 0}h project budget`} tone="sky" />
                <ProjectSignal icon={Gauge} label="Logged delivery" value={`${timeSummary?.actual_hours || 0}h`} detail="From linked ticket time" tone="emerald" />
                <ProjectSignal icon={CalendarDays} label="Target date" value={selectedProject.target_end_date ? compactDate(selectedProject.target_end_date) : "Unscheduled"} detail={isOverdue(selectedProject) ? "Past target date" : selectedProject.project_manager_name ? `Lead: ${selectedProject.project_manager_name}` : "No delivery lead assigned"} tone={isOverdue(selectedProject) ? "rose" : "amber"} />
              </div>

              <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.035] p-4">
                <div className="mb-3 flex justify-end"><Button size="sm" variant="ghost" className="h-8 text-violet-200 hover:text-violet-100" onClick={openTemplateDialog}><Plus className="mr-1.5 h-3.5 w-3.5" />Save as reusable template</Button></div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Project governance</p><h2 className="mt-1 text-base font-semibold">Accountability & close-out</h2><p className="mt-1 text-xs text-muted-foreground">Project Manager: <span className="font-medium text-foreground">{selectedProject.project_manager_name || "Unassigned"}</span></p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={openScopeDialog}><ClipboardList className="mr-1.5 h-3.5 w-3.5" />Edit scope</Button><Button size="sm" variant="outline" onClick={() => setCloseoutDialog(true)}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Close-out checks</Button><Button size="sm" variant="outline" onClick={() => setDecisionDialog(true)}><AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Raise PM decision</Button></div></div>
                {governance && <div className="mt-4 grid gap-3 lg:grid-cols-3"><div className="rounded-xl border border-border/70 bg-background/40 p-3"><p className="text-xs font-semibold">Close-out readiness</p><Badge className={`mt-2 ${governance.readiness?.ready ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>{governance.readiness?.ready ? "Ready for close-out" : "Requirements remaining"}</Badge><div className="mt-3 space-y-1.5">{(governance.readiness?.requirements || []).slice(0, 4).map((item) => <p key={item} className="text-xs text-muted-foreground">• {item}</p>)}{governance.readiness?.ready && <p className="text-xs text-emerald-200">All delivery, review, audit and billing checks are complete.</p>}</div></div><div className="rounded-xl border border-border/70 bg-background/40 p-3"><p className="text-xs font-semibold">Authoritative scope</p><p className="mt-1 text-xs text-muted-foreground">{governance.scope?.length || 0} scoped component{governance.scope?.length === 1 ? "" : "s"}</p><div className="mt-3 space-y-1.5">{(governance.scope || []).slice(0, 4).map((item) => <p key={item.id} className="flex justify-between gap-2 text-xs"><span className="truncate">{item.component}</span><span className="capitalize text-violet-200">{item.state.replaceAll("_", " ")}</span></p>)}{!governance.scope?.length && <p className="text-xs text-amber-200">Define implementation scope before close-out.</p>}</div></div><div className="rounded-xl border border-border/70 bg-background/40 p-3"><p className="text-xs font-semibold">PM decisions</p><p className="mt-1 text-xs text-muted-foreground">{governance.readiness?.summary?.open_decisions || 0} awaiting resolution</p><div className="mt-3 space-y-1.5">{(governance.decisions || []).filter((item) => item.status === "open").slice(0, 3).map((item) => <button type="button" key={item.id} className="block w-full truncate text-left text-xs text-amber-200 hover:text-amber-100" onClick={() => { setDecisionToResolve(item); setResolution(""); }}>• {item.title}</button>)}{!(governance.decisions || []).some((item) => item.status === "open") && <p className="text-xs text-emerald-200">No outstanding PM decisions.</p>}</div></div></div>}
              </section>

              {governance && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ProjectSignal icon={CheckCircle2} label="Verified delivery" value={`${governance.readiness?.summary?.completed_tasks || 0}/${governance.readiness?.summary?.total_tasks || 0}`} detail="Tasks independently checked" tone="emerald" />
                <ProjectSignal icon={ListChecks} label="Awaiting review" value={governance.readiness?.summary?.pending_reviews || 0} detail="Completed work needs a second technician" tone={governance.readiness?.summary?.pending_reviews ? "amber" : "emerald"} />
                <ProjectSignal icon={AlertTriangle} label="Delivery blockers" value={governance.readiness?.summary?.blockers || 0} detail="Must be resolved before close-out" tone={governance.readiness?.summary?.blockers ? "rose" : "emerald"} />
                <ProjectSignal icon={ClipboardList} label="PM decisions" value={governance.readiness?.summary?.open_decisions || 0} detail="Accountable direction still required" tone={governance.readiness?.summary?.open_decisions ? "amber" : "emerald"} />
              </section>}

              <section className="rounded-2xl border border-sky-400/20 bg-sky-500/[0.035] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">Ticket delivery plan</p><h2 className="mt-1 text-base font-semibold">Parent and child ticket work</h2><p className="mt-1 text-xs text-muted-foreground">Launch a ticket blueprint to create a parent delivery record and its linked work tickets without losing the project overview.</p></div><Button size="sm" variant="outline" onClick={openTicketPlanDialog}><Plus className="mr-1.5 h-4 w-4" />Launch ticket plan</Button></div>{projectTicketPlans.length > 0 && <div className="mt-3 space-y-2">{projectTicketPlans.slice(0, 3).map((plan) => <TicketPlanRow key={plan.id} plan={plan} />)}</div>}</section>

              <section><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Delivery board</p><h2 className="mt-1 text-base font-semibold">Project tasks</h2></div><Button size="sm" onClick={() => openTaskDialog()}><Plus className="mr-1.5 h-4 w-4" />Add task</Button></div>
                <div className="overflow-x-auto pb-1"><div className="grid min-w-[900px] grid-cols-4 gap-3">{Object.entries(TASK_STATUSES).map(([status, config]) => {
                  const tasks = projectTasks.filter((task) => task.status === status);
                  return <div key={status} className="rounded-xl border border-border/75 bg-muted/15 p-2.5"><div className="mb-2 flex items-center gap-2 px-1"><span className={`h-2 w-2 rounded-full ${config.dot}`} /><span className="text-xs font-semibold">{config.label}</span><Badge variant="secondary" className="ml-auto h-5 text-[10px]">{tasks.length}</Badge></div><div className="space-y-2">{tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} onEdit={() => openTaskDialog(task)} onDelete={() => deleteTask(task)} onStatusChange={(nextStatus) => updateTaskStatus(task, nextStatus)} onReview={() => { setReviewTask(task); setReviewForm({ result: "verified", notes: "" }); }} />) : <div className="rounded-lg border border-dashed border-border/90 px-3 py-5 text-center text-xs text-muted-foreground">No tasks in this stage</div>}</div></div>;
                })}</div></div>
              </section>

              <section className="border-t border-border/75 pt-5"><div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-violet-300" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Audit record</p><h2 className="mt-0.5 text-base font-semibold">Project activity</h2></div></div><div className="mt-3 space-y-2">{projectActivity.length ? projectActivity.slice(0, 12).map((event) => <div key={event.id} className="flex gap-3 rounded-xl border border-border/75 bg-muted/15 p-3"><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-400" /><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-medium">{label(event.action)}</p><p className="text-[11px] text-muted-foreground">{dateTime(event.created_at)}</p></div><p className="mt-1 text-xs text-muted-foreground">{event.details || "No detail recorded"} · {event.user_name || "System"}</p></div></div>) : <div className="rounded-xl border border-dashed border-border/90 p-4 text-sm text-muted-foreground">New project activity will appear here as people create, assign, link and complete delivery work.</div>}</div></section>
            </div>}
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(taskDialog)} onOpenChange={(open) => !open && setTaskDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Project delivery"
          title={taskDialog?.mode === "edit" ? "Update project task" : "Add project task"}
          description="Assign accountable work and optionally link it to the client ticket where time and communication are already being captured."
          icon={ListChecks}
          tone="violet"
          className="h-[min(860px,calc(100vh-1.5rem))] max-w-3xl"
          data-testid="project-task-form-dialog"
          footer={<>
            <Button type="button" variant="outline" onClick={() => setTaskDialog(null)} disabled={savingTask}>Cancel</Button>
            <Button type="submit" form="project-task-authoring-form" disabled={savingTask}>{savingTask && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{taskDialog?.mode === "edit" ? "Save task" : "Create task"}</Button>
          </>}
        >
          <form id="project-task-authoring-form" onSubmit={saveTask} className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Label htmlFor="project-task-title">Task title</Label><Input id="project-task-title" className="mt-1" required minLength={3} value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Configure conditional access baseline" /></div>
              <div className="md:col-span-2"><Label htmlFor="project-task-description">Delivery notes</Label><Textarea id="project-task-description" className="mt-1" rows={3} value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} placeholder="State the expected result, validation steps or handover requirements." /></div>
              <div><Label>Stage</Label><Select value={taskForm.status} onValueChange={(value) => setTaskForm((current) => ({ ...current, status: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Priority</Label><Select value={taskForm.priority} onValueChange={(value) => setTaskForm((current) => ({ ...current, priority: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high", "urgent"].map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="project-task-assignee">Assignee</Label><Input id="project-task-assignee" list="project-task-assignee-options" className="mt-1" value={assigneeQuery} onChange={(event) => chooseAssignee(event.target.value)} placeholder="Type to assign a technician" /><datalist id="project-task-assignee-options">{users.map((user, index) => <option key={`${user.id}-${index}`} value={user.name} />)}</datalist></div>
              <div><Label htmlFor="project-task-ticket">Related client ticket</Label><Input id="project-task-ticket" list="project-task-ticket-options" className="mt-1" value={ticketQuery} onChange={(event) => chooseTicket(event.target.value)} placeholder={clientTickets.length ? "Type to link a client ticket" : "No client ticket available"} disabled={!clientTickets.length} /><datalist id="project-task-ticket-options">{clientTickets.map((ticket) => <option key={ticket.id} value={ticketLabel(ticket)} />)}</datalist></div>
              <div><Label htmlFor="project-task-hours">Planned hours</Label><Input id="project-task-hours" className="mt-1" min="0" step="0.25" type="number" value={taskForm.estimated_hours} onChange={(event) => setTaskForm((current) => ({ ...current, estimated_hours: event.target.value }))} placeholder="e.g. 2.5" /></div>
              <div><Label htmlFor="project-task-due-date">Due date</Label><Input id="project-task-due-date" className="mt-1" type="date" value={taskForm.due_date} onChange={(event) => setTaskForm((current) => ({ ...current, due_date: event.target.value }))} /></div>
              <div className="md:col-span-2"><Label htmlFor="project-task-blocker">Blocker or decision dependency</Label><Textarea id="project-task-blocker" className="mt-1" rows={2} value={taskForm.blocker_reason} onChange={(event) => setTaskForm((current) => ({ ...current, blocker_reason: event.target.value }))} placeholder="Leave blank when clear to proceed. A recorded blocker keeps close-out honest and visible." /></div>
          </form>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={decisionDialog} onOpenChange={setDecisionDialog}>
        <NexusWorkflowDialog eyebrow="Project governance" title="Request a Project Manager decision" description="Use this when delivery cannot proceed without an accountable scope, commercial, technical, or customer decision. The decision remains visible until it is resolved." icon={AlertTriangle} tone="amber" footer={<><Button variant="outline" onClick={() => setDecisionDialog(false)}>Cancel</Button><Button onClick={raiseDecision}>Raise decision</Button></>}>
          <div className="space-y-4"><div><Label>Decision required</Label><Input className="mt-1" value={decisionForm.title} onChange={(event) => setDecisionForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Confirm optional email security service" /></div><div><Label>Context and impact</Label><Textarea className="mt-1" rows={4} value={decisionForm.detail} onChange={(event) => setDecisionForm((current) => ({ ...current, detail: event.target.value }))} placeholder="Explain what is blocked, the available choices and the impact of waiting." /></div></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <NexusWorkflowDialog eyebrow="Delivery standardisation" title="Save as reusable project template" description="Nexus copies the current authoritative scope and task plan into a new MSP-wide template. Future projects receive their own independent records and audit trail." icon={FolderKanban} tone="violet" footer={<><Button variant="outline" onClick={() => setTemplateDialog(false)}>Cancel</Button><Button onClick={publishProjectTemplate}>Publish template</Button></>}>
          <div className="space-y-4"><div><Label>Template name</Label><Input className="mt-1" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Standard client onboarding" /></div><div><Label>Template description</Label><Textarea className="mt-1" rows={4} value={templateForm.description} onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))} placeholder="Explain when this delivery plan should be used and its intended outcome." /></div><p className="rounded-xl border border-violet-400/20 bg-violet-500/[0.045] p-3 text-xs text-muted-foreground">The current scope and delivery tasks must be present. Project-specific decisions, evidence, people, dates, linked tickets and activity are never copied.</p></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={ticketPlanDialog} onOpenChange={setTicketPlanDialog}>
        <NexusWorkflowDialog eyebrow="Project delivery" title="Launch parent and child ticket plan" description="Nexus applies the selected ticket blueprint to one parent delivery ticket, then creates the blueprint's child tickets and links them back to this project." icon={ClipboardList} tone="sky" footer={<><Button variant="outline" onClick={() => setTicketPlanDialog(false)} disabled={launchingTicketPlan}>Cancel</Button><Button onClick={launchTicketPlan} disabled={launchingTicketPlan}>{launchingTicketPlan && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Launch ticket plan</Button></>}>
          <div className="space-y-4"><div><Label>Ticket blueprint</Label><Select value={ticketPlanForm.blueprint_id || "__none"} onValueChange={(blueprint_id) => setTicketPlanForm((current) => ({ ...current, blueprint_id: blueprint_id === "__none" ? "" : blueprint_id }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Select a parent-and-child ticket blueprint" /></SelectTrigger><SelectContent><SelectItem value="__none">Select a ticket blueprint…</SelectItem>{ticketBlueprints.map((blueprint) => <SelectItem key={blueprint.id} value={blueprint.id}>{blueprint.name}{blueprint.child_templates?.length ? ` · ${blueprint.child_templates.length} child work type${blueprint.child_templates.length === 1 ? "" : "s"}` : " · parent only"}</SelectItem>)}</SelectContent></Select></div>{ticketPlanForm.blueprint_id && (() => { const blueprint = ticketBlueprints.find((item) => item.id === ticketPlanForm.blueprint_id); return blueprint ? <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.045] p-3"><p className="text-sm font-medium">{blueprint.name}</p><p className="mt-1 text-xs text-muted-foreground">{blueprint.description || "No blueprint description recorded."}</p><p className="mt-2 text-xs text-sky-100">{blueprint.child_templates?.length || 0} child work type{blueprint.child_templates?.length === 1 ? "" : "s"}; per-device work expands for the client’s enrolled devices.</p></div> : null; })()}<div><Label>Parent ticket title</Label><Input className="mt-1" value={ticketPlanForm.title} onChange={(event) => setTicketPlanForm((current) => ({ ...current, title: event.target.value }))} placeholder="Project delivery plan" /></div><div><Label>Parent ticket context</Label><Textarea className="mt-1" rows={3} value={ticketPlanForm.description} onChange={(event) => setTicketPlanForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional project-specific context for the parent ticket." /></div><p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.045] p-3 text-xs text-muted-foreground">A blueprint can only be launched once per project. Reopening this workflow returns the same plan instead of duplicating service work.</p></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={scopeDialog} onOpenChange={setScopeDialog}>
        <NexusWorkflowDialog eyebrow="Project governance" title="Define authoritative scope" description="Record the components that must be delivered, are optional, or are explicitly out of scope. Only the Project Manager or an administrator can save this record." icon={ClipboardList} tone="violet" footer={<><Button variant="outline" onClick={() => setScopeDialog(false)}>Cancel</Button><Button onClick={saveScope}>Save scope</Button></>}>
          <div className="space-y-3">{scopeDraft.map((item, index) => <div key={`${item.component}-${index}`} className="grid gap-2 rounded-xl border border-border/70 p-3 md:grid-cols-[minmax(0,1fr)_170px_auto]"><div><Label className="text-[11px]">Component</Label><Input className="mt-1" value={item.component} onChange={(event) => setScopeDraft((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, component: event.target.value } : entry))} placeholder="e.g. Conditional Access baseline" /></div><div><Label className="text-[11px]">Scope state</Label><Select value={item.state} onValueChange={(state) => setScopeDraft((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state } : entry))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="required">Required</SelectItem><SelectItem value="optional">Optional</SelectItem><SelectItem value="not_applicable">Not applicable</SelectItem></SelectContent></Select></div><Button type="button" variant="ghost" size="icon" className="self-end text-muted-foreground hover:text-destructive" onClick={() => setScopeDraft((current) => current.filter((_, entryIndex) => entryIndex !== index))}><Trash2 className="h-4 w-4" /></Button><div className="md:col-span-2"><Label className="text-[11px]">Delivery note</Label><Input className="mt-1" value={item.notes} onChange={(event) => setScopeDraft((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, notes: event.target.value } : entry))} placeholder="Success criteria, exception, or handover note" /></div></div>)}<Button type="button" variant="outline" className="w-full" onClick={() => setScopeDraft((current) => [...current, { component: "", state: "required", notes: "" }])}><Plus className="mr-1.5 h-4 w-4" />Add scoped component</Button></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(reviewTask)} onOpenChange={(open) => !open && setReviewTask(null)}>
        <NexusWorkflowDialog eyebrow="Independent delivery review" title={`Review: ${reviewTask?.title || "project task"}`} description="A second technician verifies the completed work. Nexus blocks the implementing technician from approving their own delivery." icon={CheckCircle2} tone="emerald" footer={<><Button variant="outline" onClick={() => setReviewTask(null)}>Cancel</Button><Button onClick={submitTaskReview}>{reviewForm.result === "verified" ? "Verify work" : "Request changes"}</Button></>}>
          <div className="space-y-4"><div><Label>Review result</Label><Select value={reviewForm.result} onValueChange={(result) => setReviewForm((current) => ({ ...current, result }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="verified">Verified — safe to close</SelectItem><SelectItem value="changes_requested">Changes requested — return to delivery</SelectItem></SelectContent></Select></div><div><Label>Evidence or required changes <span className="text-rose-300">(required)</span></Label><Textarea className="mt-1" rows={4} value={reviewForm.notes} onChange={(event) => setReviewForm((current) => ({ ...current, notes: event.target.value }))} placeholder={reviewForm.result === "verified" ? "Record the validation performed, evidence captured, and why the result is accepted." : "Record the exact changes required before work returns to delivery."} /></div></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(decisionToResolve)} onOpenChange={(open) => !open && setDecisionToResolve(null)}>
        <NexusWorkflowDialog eyebrow="Project Manager decision" title={decisionToResolve?.title || "Resolve decision"} description={decisionToResolve?.detail || "Record the accountable outcome so project delivery can continue."} icon={AlertTriangle} tone="amber" footer={<><Button variant="outline" onClick={() => setDecisionToResolve(null)}>Cancel</Button><Button onClick={resolveDecision}>Resolve decision</Button></>}>
          <div><Label>Resolution and delivery direction</Label><Textarea className="mt-1" rows={4} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="State what was approved, changed, deferred, or declined and the next delivery step." /></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={closeoutDialog} onOpenChange={setCloseoutDialog}>
        <NexusWorkflowDialog eyebrow="Project governance" title="Complete close-out checks" description="Project completion remains blocked until every required close-out check, task review, scope decision, and blocker is resolved." icon={CheckCircle2} tone="emerald" footer={<Button variant="outline" onClick={() => setCloseoutDialog(false)}>Done</Button>}>
          <div className="space-y-3">{["final_audit", "billing_confirmed", "documentation_complete", "exceptions_documented"].map((check) => { const record = (governance?.closeout_checks || []).find((item) => item.check === check); return <div key={check} className="rounded-xl border border-border/70 p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{label(check)}</p><p className="mt-1 text-xs text-muted-foreground">{record?.completed ? `Confirmed by ${record.updated_by_name || "Nexus"}` : "Not yet confirmed"}</p></div><Button size="sm" variant={record?.completed ? "outline" : "default"} onClick={() => saveCloseoutCheck(check, !record?.completed)}>{record?.completed ? "Mark incomplete" : "Mark complete"}</Button></div><Textarea className="mt-3" rows={2} value={closeoutNotes[check] ?? record?.notes ?? ""} onChange={(event) => setCloseoutNotes((current) => ({ ...current, [check]: event.target.value }))} placeholder="Evidence, audit location, invoice reference, or documented exception" /></div>; })}</div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Client delivery"
          title={deleteTarget?.type === "project" ? "Delete delivery project" : "Delete project task"}
          description={deleteTarget?.type === "project"
            ? `Delete ${deleteTarget.item.name}? All project tasks will be removed.`
            : `Delete ${deleteTarget?.item?.title || "this task"}?`}
          icon={Trash2}
          tone="amber"
          testId="project-delete-dialog"
          footer={<><Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep {deleteTarget?.type === "project" ? "project" : "task"}</Button><Button variant="destructive" onClick={() => deleteTarget?.type === "project" ? deleteProject(deleteTarget.item, true) : deleteTask(deleteTarget.item, true)}>Delete {deleteTarget?.type === "project" ? "project" : "task"}</Button></>}
        >
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3 text-sm text-muted-foreground">
            {deleteTarget?.type === "project" ? "The project, its tasks and the associated delivery board are removed. Nexus keeps the recorded audit event." : "The task is removed from the delivery board and Nexus records the decision in project activity."}
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

function ProjectSignal({ icon: Icon, label: signalLabel, value, detail, tone = "violet" }) {
  const tones = { violet: "text-violet-300", sky: "text-sky-300", emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300" };
  return <Card className="border-border/75 bg-muted/15"><CardContent className="p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Icon className={`h-3.5 w-3.5 ${tones[tone] || tones.violet}`} />{signalLabel}</div><p className="mt-2 truncate text-lg font-semibold">{value}</p><p className={`mt-1 truncate text-[11px] ${tone === "rose" ? "text-rose-300" : "text-muted-foreground"}`}>{detail}</p></CardContent></Card>;
}

function TaskCard({ task, onEdit, onDelete, onStatusChange, onReview }) {
  return <div className="rounded-lg border border-border/80 bg-background/60 p-3 shadow-sm"><div className="flex gap-2"><button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}><p className="line-clamp-2 text-sm font-medium hover:text-violet-200">{task.title}</p>{task.description && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{task.description}</p>}</button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" />Edit task</DropdownMenuItem>{task.status === "completed" && task.review_result !== "verified" && <DropdownMenuItem onClick={onReview}><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Review completed work</DropdownMenuItem>}<DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete task</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><div className="mt-3 flex flex-wrap items-center gap-1.5"><Badge variant="outline" className={`h-5 text-[9px] ${PRIORITY_STYLES[task.priority] || ""}`}>{label(task.priority)}</Badge>{task.ticket_number && <Badge variant="outline" className="h-5 max-w-full truncate text-[9px] text-violet-200">#{task.ticket_number}</Badge>}{task.review_result === "verified" && <Badge variant="outline" className="h-5 border-emerald-400/30 bg-emerald-400/10 text-[9px] text-emerald-200">Verified</Badge>}{task.review_result === "changes_requested" && <Badge variant="outline" className="h-5 border-amber-400/30 bg-amber-400/10 text-[9px] text-amber-200">Changes requested</Badge>}</div>{task.blocker_reason && <p className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.05] px-2 py-1 text-[10px] text-amber-100">Blocked: {task.blocker_reason}</p>}<div className="mt-3 flex items-center justify-between gap-2"><p className="truncate text-[10px] text-muted-foreground">{task.assigned_name || "Unassigned"}{task.due_date ? ` · ${compactDate(task.due_date)}` : ""}</p><Select value={task.status} onValueChange={onStatusChange}><SelectTrigger className="h-6 w-[92px] border-border/60 bg-muted/30 px-2 text-[10px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent></Select></div></div>;
}
