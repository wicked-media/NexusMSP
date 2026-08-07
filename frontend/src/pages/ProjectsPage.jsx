import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

export default function ProjectsPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectDialog, setProjectDialog] = useState(null);
  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT);
  const [clientQuery, setClientQuery] = useState("");
  const [managerQuery, setManagerQuery] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [projectActivity, setProjectActivity] = useState([]);
  const [timeSummary, setTimeSummary] = useState(null);
  const [clientTickets, setClientTickets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [taskDialog, setTaskDialog] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  const fetchData = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [projectsResponse, clientsResponse, usersResponse] = await Promise.all([
        axios.get(`${API}/projects`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers }),
      ]);
      setProjects(projectsResponse.data || []);
      setClients(clientsResponse.data || []);
      setUsers(usersResponse.data || []);
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
    setTimeSummary(null);
    try {
      const requests = [
        axios.get(`${API}/projects/${project.id}/tasks`, { headers }),
        axios.get(`${API}/projects/${project.id}/time-summary`, { headers }),
        axios.get(`${API}/projects/${project.id}/activity`, { headers }),
      ];
      if (project.client_id) requests.push(axios.get(`${API}/tickets?client_id=${project.client_id}`, { headers }));
      const [tasksResponse, summaryResponse, activityResponse, ticketsResponse] = await Promise.all(requests);
      setProjectTasks(tasksResponse.data || []);
      setTimeSummary(summaryResponse.data || null);
      setProjectActivity(activityResponse.data || []);
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
  };

  const openNewProject = () => {
    setProjectForm(EMPTY_PROJECT);
    setClientQuery("");
    setManagerQuery("");
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
    setSavingProject(true);
    try {
      const payload = {
        ...projectForm,
        budget_hours: projectForm.budget_hours === "" ? null : Number(projectForm.budget_hours),
      };
      if (projectDialog?.mode === "edit") {
        await axios.put(`${API}/projects/${projectDialog.project.id}`, payload, { headers });
        toast.success("Project updated and recorded in the activity trail");
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

  const deleteProject = async (project) => {
    if (!window.confirm(`Delete ${project.name}? All project tasks will be removed. This is recorded in the audit trail.`)) return;
    try {
      await axios.delete(`${API}/projects/${project.id}`, { headers });
      toast.success("Project deleted");
      setSelectedProject(null);
      await fetchData({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Project could not be deleted");
    }
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
    try {
      await axios.put(`${API}/projects/${selectedProject.id}/tasks/${task.id}`, { status }, { headers });
      toast.success(`${task.title} moved to ${TASK_STATUSES[status].label}`);
      await reloadProjectDetail();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Task status could not be updated");
    }
  };

  const deleteTask = async (task) => {
    if (!selectedProject || !window.confirm(`Delete task \"${task.title}\"?`)) return;
    try {
      await axios.delete(`${API}/projects/${selectedProject.id}/tasks/${task.id}`, { headers });
      toast.success("Task deleted");
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
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0">
          <DialogHeader className="border-b border-border/80 px-6 py-5"><DialogTitle className="flex items-center gap-2"><FolderKanban className="h-5 w-5 text-violet-300" />{projectDialog?.mode === "edit" ? "Update project record" : "Create delivery project"}</DialogTitle><p className="text-sm text-muted-foreground">Capture the client scope, accountable delivery lead, dates and the capacity you intend to deliver.</p></DialogHeader>
          <form onSubmit={saveProject} className="space-y-5 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Label htmlFor="project-name">Project name</Label><Input id="project-name" className="mt-1" required minLength={3} value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. M365 tenant migration" /></div>
              <div><Label htmlFor="project-client">Client</Label><Input id="project-client" list="project-client-options" className="mt-1" required value={clientQuery} onChange={(event) => chooseClient(event.target.value)} placeholder="Type to find a client" /><datalist id="project-client-options">{clients.map((client) => <option key={client.id} value={client.name} />)}</datalist><p className="mt-1 text-[11px] text-muted-foreground">Select a suggested client so the project and linked tickets stay in the same account.</p></div>
              <div><Label htmlFor="project-manager">Delivery lead</Label><Input id="project-manager" list="project-manager-options" className="mt-1" value={managerQuery} onChange={(event) => chooseManager(event.target.value)} placeholder="Type to assign a lead" /><datalist id="project-manager-options">{users.map((user, index) => <option key={`${user.id}-${index}`} value={user.name} />)}</datalist></div>
              <div className="md:col-span-2"><Label htmlFor="project-description">Project brief</Label><Textarea id="project-description" className="mt-1" rows={4} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} placeholder="Define the client outcome, scope boundaries, delivery assumptions and handover expectations." /></div>
              <div><Label>Status</Label><Select value={projectForm.status} onValueChange={(value) => setProjectForm((current) => ({ ...current, status: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PROJECT_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Priority</Label><Select value={projectForm.priority} onValueChange={(value) => setProjectForm((current) => ({ ...current, priority: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high", "urgent"].map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="project-start-date">Start date</Label><Input id="project-start-date" className="mt-1" type="date" value={projectForm.start_date} onChange={(event) => setProjectForm((current) => ({ ...current, start_date: event.target.value }))} /></div>
              <div><Label htmlFor="project-target-date">Target completion</Label><Input id="project-target-date" className="mt-1" type="date" value={projectForm.target_end_date} onChange={(event) => setProjectForm((current) => ({ ...current, target_end_date: event.target.value }))} /></div>
              <div><Label htmlFor="project-budget-hours">Planned hours</Label><Input id="project-budget-hours" className="mt-1" min="0" step="0.25" type="number" value={projectForm.budget_hours} onChange={(event) => setProjectForm((current) => ({ ...current, budget_hours: event.target.value }))} placeholder="e.g. 36" /></div>
            </div>
            <DialogFooter className="border-t border-border/80 pt-5"><Button type="button" variant="outline" onClick={closeProjectDialog} disabled={savingProject}>Cancel</Button><Button type="submit" disabled={savingProject}>{savingProject && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{projectDialog?.mode === "edit" ? "Save project" : "Create project"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedProject)} onOpenChange={(open) => !open && setSelectedProject(null)}>
        <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto p-0">
          {selectedProject && <>
            <DialogHeader className="border-b border-border/80 px-6 py-5"><div className="flex flex-col gap-4 pr-6 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">{selectedProject.client_name || "Client delivery"}</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl"><FolderKanban className="h-5 w-5 text-violet-300" />{selectedProject.name}</DialogTitle><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{selectedProject.description || "No project brief has been recorded."}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Badge variant="outline" className={PROJECT_STATUSES[selectedProject.status]?.className}>{PROJECT_STATUSES[selectedProject.status]?.label || label(selectedProject.status)}</Badge><Button variant="outline" size="sm" onClick={() => openEditProject(selectedProject)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteProject(selectedProject)}><Trash2 className="h-3.5 w-3.5" /></Button></div></div></DialogHeader>
            {detailLoading ? <div className="flex h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div> : <div className="space-y-6 px-6 py-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ProjectSignal icon={Target} label="Task completion" value={`${timeSummary?.completed_tasks || 0}/${timeSummary?.total_tasks || 0}`} detail={`${timeSummary?.completion_pct || 0}% delivery complete`} tone="violet" />
                <ProjectSignal icon={Clock3} label="Planned capacity" value={`${timeSummary?.estimated_hours || 0}h`} detail={`${selectedProject.budget_hours || 0}h project budget`} tone="sky" />
                <ProjectSignal icon={Gauge} label="Logged delivery" value={`${timeSummary?.actual_hours || 0}h`} detail="From linked ticket time" tone="emerald" />
                <ProjectSignal icon={CalendarDays} label="Target date" value={selectedProject.target_end_date ? compactDate(selectedProject.target_end_date) : "Unscheduled"} detail={isOverdue(selectedProject) ? "Past target date" : selectedProject.project_manager_name ? `Lead: ${selectedProject.project_manager_name}` : "No delivery lead assigned"} tone={isOverdue(selectedProject) ? "rose" : "amber"} />
              </div>

              <section><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Delivery board</p><h2 className="mt-1 text-base font-semibold">Project tasks</h2></div><Button size="sm" onClick={() => openTaskDialog()}><Plus className="mr-1.5 h-4 w-4" />Add task</Button></div>
                <div className="overflow-x-auto pb-1"><div className="grid min-w-[900px] grid-cols-4 gap-3">{Object.entries(TASK_STATUSES).map(([status, config]) => {
                  const tasks = projectTasks.filter((task) => task.status === status);
                  return <div key={status} className="rounded-xl border border-border/75 bg-muted/15 p-2.5"><div className="mb-2 flex items-center gap-2 px-1"><span className={`h-2 w-2 rounded-full ${config.dot}`} /><span className="text-xs font-semibold">{config.label}</span><Badge variant="secondary" className="ml-auto h-5 text-[10px]">{tasks.length}</Badge></div><div className="space-y-2">{tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} onEdit={() => openTaskDialog(task)} onDelete={() => deleteTask(task)} onStatusChange={(nextStatus) => updateTaskStatus(task, nextStatus)} />) : <div className="rounded-lg border border-dashed border-border/90 px-3 py-5 text-center text-xs text-muted-foreground">No tasks in this stage</div>}</div></div>;
                })}</div></div>
              </section>

              <section className="border-t border-border/75 pt-5"><div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-violet-300" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Audit record</p><h2 className="mt-0.5 text-base font-semibold">Project activity</h2></div></div><div className="mt-3 space-y-2">{projectActivity.length ? projectActivity.slice(0, 12).map((event) => <div key={event.id} className="flex gap-3 rounded-xl border border-border/75 bg-muted/15 p-3"><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-400" /><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-medium">{label(event.action)}</p><p className="text-[11px] text-muted-foreground">{dateTime(event.created_at)}</p></div><p className="mt-1 text-xs text-muted-foreground">{event.details || "No detail recorded"} · {event.user_name || "System"}</p></div></div>) : <div className="rounded-xl border border-dashed border-border/90 p-4 text-sm text-muted-foreground">New project activity will appear here as people create, assign, link and complete delivery work.</div>}</div></section>
            </div>}
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(taskDialog)} onOpenChange={(open) => !open && setTaskDialog(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0">
          <DialogHeader className="border-b border-border/80 px-6 py-5"><DialogTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-violet-300" />{taskDialog?.mode === "edit" ? "Update project task" : "Add project task"}</DialogTitle><p className="text-sm text-muted-foreground">Assign accountable work and optionally link it to the client ticket where time and communication are already being captured.</p></DialogHeader>
          <form onSubmit={saveTask} className="space-y-5 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Label htmlFor="project-task-title">Task title</Label><Input id="project-task-title" className="mt-1" required minLength={3} value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Configure conditional access baseline" /></div>
              <div className="md:col-span-2"><Label htmlFor="project-task-description">Delivery notes</Label><Textarea id="project-task-description" className="mt-1" rows={3} value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} placeholder="State the expected result, validation steps or handover requirements." /></div>
              <div><Label>Stage</Label><Select value={taskForm.status} onValueChange={(value) => setTaskForm((current) => ({ ...current, status: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Priority</Label><Select value={taskForm.priority} onValueChange={(value) => setTaskForm((current) => ({ ...current, priority: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high", "urgent"].map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="project-task-assignee">Assignee</Label><Input id="project-task-assignee" list="project-task-assignee-options" className="mt-1" value={assigneeQuery} onChange={(event) => chooseAssignee(event.target.value)} placeholder="Type to assign a technician" /><datalist id="project-task-assignee-options">{users.map((user, index) => <option key={`${user.id}-${index}`} value={user.name} />)}</datalist></div>
              <div><Label htmlFor="project-task-ticket">Related client ticket</Label><Input id="project-task-ticket" list="project-task-ticket-options" className="mt-1" value={ticketQuery} onChange={(event) => chooseTicket(event.target.value)} placeholder={clientTickets.length ? "Type to link a client ticket" : "No client ticket available"} disabled={!clientTickets.length} /><datalist id="project-task-ticket-options">{clientTickets.map((ticket) => <option key={ticket.id} value={ticketLabel(ticket)} />)}</datalist></div>
              <div><Label htmlFor="project-task-hours">Planned hours</Label><Input id="project-task-hours" className="mt-1" min="0" step="0.25" type="number" value={taskForm.estimated_hours} onChange={(event) => setTaskForm((current) => ({ ...current, estimated_hours: event.target.value }))} placeholder="e.g. 2.5" /></div>
              <div><Label htmlFor="project-task-due-date">Due date</Label><Input id="project-task-due-date" className="mt-1" type="date" value={taskForm.due_date} onChange={(event) => setTaskForm((current) => ({ ...current, due_date: event.target.value }))} /></div>
            </div>
            <DialogFooter className="border-t border-border/80 pt-5"><Button type="button" variant="outline" onClick={() => setTaskDialog(null)} disabled={savingTask}>Cancel</Button><Button type="submit" disabled={savingTask}>{savingTask && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{taskDialog?.mode === "edit" ? "Save task" : "Create task"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectSignal({ icon: Icon, label: signalLabel, value, detail, tone = "violet" }) {
  const tones = { violet: "text-violet-300", sky: "text-sky-300", emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300" };
  return <Card className="border-border/75 bg-muted/15"><CardContent className="p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Icon className={`h-3.5 w-3.5 ${tones[tone] || tones.violet}`} />{signalLabel}</div><p className="mt-2 truncate text-lg font-semibold">{value}</p><p className={`mt-1 truncate text-[11px] ${tone === "rose" ? "text-rose-300" : "text-muted-foreground"}`}>{detail}</p></CardContent></Card>;
}

function TaskCard({ task, onEdit, onDelete, onStatusChange }) {
  return <div className="rounded-lg border border-border/80 bg-background/60 p-3 shadow-sm"><div className="flex gap-2"><button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}><p className="line-clamp-2 text-sm font-medium hover:text-violet-200">{task.title}</p>{task.description && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{task.description}</p>}</button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" />Edit task</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete task</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><div className="mt-3 flex flex-wrap items-center gap-1.5"><Badge variant="outline" className={`h-5 text-[9px] ${PRIORITY_STYLES[task.priority] || ""}`}>{label(task.priority)}</Badge>{task.ticket_number && <Badge variant="outline" className="h-5 max-w-full truncate text-[9px] text-violet-200">#{task.ticket_number}</Badge>}</div><div className="mt-3 flex items-center justify-between gap-2"><p className="truncate text-[10px] text-muted-foreground">{task.assigned_name || "Unassigned"}{task.due_date ? ` · ${compactDate(task.due_date)}` : ""}</p><Select value={task.status} onValueChange={onStatusChange}><SelectTrigger className="h-6 w-[92px] border-border/60 bg-muted/30 px-2 text-[10px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_STATUSES).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent></Select></div></div>;
}
