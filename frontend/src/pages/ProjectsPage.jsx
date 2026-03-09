import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  FolderKanban,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle,
  Clock,
  AlertCircle,
  MoreVertical,
  Calendar,
  Users,
  Target
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";

const statusConfig = {
  planning: { label: "Planning", color: "bg-gray-500", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-blue-500", icon: AlertCircle },
  on_hold: { label: "On Hold", color: "bg-yellow-500", icon: Clock },
  completed: { label: "Completed", color: "bg-green-500", icon: CheckCircle },
  cancelled: { label: "Cancelled", color: "bg-red-500", icon: AlertCircle }
};

const taskStatusConfig = {
  todo: { label: "To Do", color: "bg-gray-500" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  review: { label: "Review", color: "bg-yellow-500" },
  completed: { label: "Completed", color: "bg-green-500" }
};

export default function ProjectsPage() {
  const { token } = useAuth();
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    client_id: "",
    status: "planning",
    priority: "medium",
    start_date: "",
    target_end_date: "",
    budget_hours: "",
    project_manager: ""
  });
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    status: "todo",
    priority: "medium",
    assigned_to: "",
    estimated_hours: "",
    due_date: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [projectsRes, clientsRes, usersRes] = await Promise.all([
        axios.get(`${API}/projects`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers })
      ]);
      setProjects(projectsRes.data);
      setClients(clientsRes.data);
      setUsers(usersRes.data);
    } catch (error) {
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectTasks = async (projectId) => {
    try {
      const res = await axios.get(`${API}/projects/${projectId}/tasks`, { headers });
      setProjectTasks(res.data);
    } catch (error) {
      toast.error("Failed to fetch tasks");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchProjectTasks(selectedProject.id);
    }
  }, [selectedProject]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        budget_hours: formData.budget_hours ? parseFloat(formData.budget_hours) : null
      };
      if (selectedProject && !isTaskDialogOpen) {
        await axios.put(`${API}/projects/${selectedProject.id}`, payload, { headers });
        toast.success("Project updated");
      } else {
        await axios.post(`${API}/projects`, payload, { headers });
        toast.success("Project created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      toast.error("Failed to save project");
    }
  };

  const handleTaskSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...taskForm,
        estimated_hours: taskForm.estimated_hours ? parseFloat(taskForm.estimated_hours) : null
      };
      await axios.post(`${API}/projects/${selectedProject.id}/tasks`, payload, { headers });
      toast.success("Task created");
      setIsTaskDialogOpen(false);
      setTaskForm({
        title: "",
        description: "",
        status: "todo",
        priority: "medium",
        assigned_to: "",
        estimated_hours: "",
        due_date: ""
      });
      fetchProjectTasks(selectedProject.id);
    } catch (error) {
      toast.error("Failed to save task");
    }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      await axios.put(`${API}/projects/${selectedProject.id}/tasks/${taskId}`, { status: newStatus }, { headers });
      toast.success("Task updated");
      fetchProjectTasks(selectedProject.id);
      // Also refresh projects to update task counts in the list
      fetchData();
    } catch (error) {
      toast.error("Failed to update task");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this project and all its tasks?")) return;
    try {
      await axios.delete(`${API}/projects/${id}`, { headers });
      toast.success("Project deleted");
      setSelectedProject(null);
      fetchData();
    } catch (error) {
      toast.error("Failed to delete project");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      client_id: "",
      status: "planning",
      priority: "medium",
      start_date: "",
      target_end_date: "",
      budget_hours: "",
      project_manager: ""
    });
  };

  const openEditDialog = (project) => {
    setFormData({
      name: project.name,
      description: project.description || "",
      client_id: project.client_id,
      status: project.status,
      priority: project.priority,
      start_date: project.start_date || "",
      target_end_date: project.target_end_date || "",
      budget_hours: project.budget_hours || "",
      project_manager: project.project_manager || ""
    });
    setIsDialogOpen(true);
  };

  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getProgressPercent = (project) => {
    if (!project.budget_hours) return 0;
    return Math.min(100, (project.spent_hours / project.budget_hours) * 100);
  };

  return (
    <div className="space-y-6" data-testid="projects-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">Manage client projects and tasks</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="create-project-btn">
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{selectedProject ? "Edit Project" : "Create Project"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Project Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Office 365 Migration"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Client *</Label>
                    <Select value={formData.client_id} onValueChange={(v) => setFormData({ ...formData, client_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>
                        {clients.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Project description..."
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(statusConfig).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Budget Hours</Label>
                    <Input
                      type="number"
                      value={formData.budget_hours}
                      onChange={(e) => setFormData({ ...formData, budget_hours: e.target.value })}
                      placeholder="40"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Target End Date</Label>
                    <Input
                      type="date"
                      value={formData.target_end_date}
                      onChange={(e) => setFormData({ ...formData, target_end_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Project Manager</Label>
                    <Select value={formData.project_manager} onValueChange={(v) => setFormData({ ...formData, project_manager: v })}>
                      <SelectTrigger><SelectValue placeholder="Assign PM" /></SelectTrigger>
                      <SelectContent>
                        {users.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">{selectedProject ? "Update" : "Create Project"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FolderKanban className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{projects.length}</p>
              <p className="text-xs text-muted-foreground">Total Projects</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{projects.filter(p => p.status === 'in_progress').length}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{projects.filter(p => p.status === 'completed').length}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{projects.reduce((acc, p) => acc + (p.spent_hours || 0), 0).toFixed(1)}h</p>
              <p className="text-xs text-muted-foreground">Total Hours</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(statusConfig).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map(project => {
            const StatusIcon = statusConfig[project.status]?.icon || Clock;
            return (
              <Card key={project.id} className="card-hover cursor-pointer" onClick={() => setSelectedProject(project)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{project.name}</h3>
                      <p className="text-xs text-muted-foreground">{project.client_name}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(project); }}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  
                  {project.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{project.description}</p>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <Badge className={`${statusConfig[project.status]?.color} text-white`}>
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {statusConfig[project.status]?.label}
                    </Badge>
                    <Badge variant="outline">{project.priority}</Badge>
                  </div>

                  {project.budget_hours && (
                    <div className="space-y-1 mb-3">
                      <div className="flex justify-between text-xs">
                        <span>{project.spent_hours || 0}h spent</span>
                        <span>{project.budget_hours}h budget</span>
                      </div>
                      <Progress value={getProgressPercent(project)} className="h-1.5" />
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {project.project_manager_name && (
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {project.project_manager_name}
                      </div>
                    )}
                    {project.target_end_date && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {project.target_end_date}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64">
          <FolderKanban className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
          <p className="text-muted-foreground">No projects found</p>
        </div>
      )}

      {/* Project Detail Dialog */}
      <Dialog open={!!selectedProject} onOpenChange={(open) => { if (!open) setSelectedProject(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedProject && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle>{selectedProject.name}</DialogTitle>
                    <p className="text-sm text-muted-foreground">{selectedProject.client_name}</p>
                  </div>
                  <Badge className={`${statusConfig[selectedProject.status]?.color} text-white`}>
                    {statusConfig[selectedProject.status]?.label}
                  </Badge>
                </div>
              </DialogHeader>
              
              <div className="space-y-4">
                {selectedProject.description && (
                  <p className="text-sm text-muted-foreground">{selectedProject.description}</p>
                )}

                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Tasks</h4>
                  <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm"><Plus className="w-4 h-4 mr-2" />Add Task</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Task</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleTaskSubmit} className="space-y-4">
                        <div className="space-y-2">
                          <Label>Title *</Label>
                          <Input
                            value={taskForm.title}
                            onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                            placeholder="Setup Azure AD"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Description</Label>
                          <Textarea
                            value={taskForm.description}
                            onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                            rows={2}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Assigned To</Label>
                            <Select value={taskForm.assigned_to} onValueChange={(v) => setTaskForm({ ...taskForm, assigned_to: v })}>
                              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                              <SelectContent>
                                {users.map(u => (
                                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Est. Hours</Label>
                            <Input
                              type="number"
                              value={taskForm.estimated_hours}
                              onChange={(e) => setTaskForm({ ...taskForm, estimated_hours: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Due Date</Label>
                          <Input
                            type="date"
                            value={taskForm.due_date}
                            onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                          />
                        </div>
                        <DialogFooter>
                          <Button type="submit">Create Task</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                <ScrollArea className="h-[300px]">
                  {projectTasks.length > 0 ? (
                    <div className="space-y-2">
                      {projectTasks.map(task => (
                        <div key={task.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <p className="font-medium">{task.title}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {task.assigned_name && <span>{task.assigned_name}</span>}
                              {task.estimated_hours && <span>• {task.estimated_hours}h</span>}
                              {task.due_date && <span>• Due: {task.due_date}</span>}
                            </div>
                          </div>
                          <Select value={task.status} onValueChange={(v) => updateTaskStatus(task.id, v)}>
                            <SelectTrigger className="w-[130px]">
                              <Badge className={`${taskStatusConfig[task.status]?.color} text-white text-xs`}>
                                {taskStatusConfig[task.status]?.label}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(taskStatusConfig).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-[200px]">
                      <Target className="w-8 h-8 text-muted-foreground opacity-50 mb-2" />
                      <p className="text-sm text-muted-foreground">No tasks yet</p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
