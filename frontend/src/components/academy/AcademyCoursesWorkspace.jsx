import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import AcademyAssignmentEvidence from "./AcademyAssignmentEvidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Eye,
  FilePenLine,
  GraduationCap,
  LayoutTemplate,
  Library,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

const SECURITY_AWARENESS_TEMPLATE = [
  "Spot the signal",
  "Pause when a message creates urgency, requests a credential, asks you to bypass a process, or directs you to an unfamiliar sign-in page.",
  "Verify through a known channel",
  "Use the Nexus record, published contact details, or a known phone number. Do not reply to the suspected message or reuse a link it supplied.",
  "Report and contain",
  "Report suspected phishing or social engineering promptly. Preserve the message and context, then follow the owning incident or service workflow.",
].join("\n\n");

function emptyCourse(category = "academy") {
  const security = category === "security_awareness";
  return {
    title: security ? "Nexus Secure Habits" : "",
    description: security
      ? "A practical Nexus security-awareness lesson for recognising, verifying and reporting suspicious requests."
      : "",
    category,
    content: security ? SECURITY_AWARENESS_TEMPLATE : "",
    estimated_minutes: security ? 8 : 10,
    required: security,
    published: false,
    archived: false,
    assessment: [],
    passing_score: 100,
  };
}

function courseRows(data) {
  const rows = Array.isArray(data) ? data : data?.courses;
  return Array.isArray(rows) ? rows : [];
}

function learnerCourse(row) {
  const course = row?.course || row || {};
  return { ...course, assignment: row?.assignment || course.assignment || null };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === "string" ? item : item?.body || item?.content || item?.title || "")).filter(Boolean).join("\n\n");
  }
  return "";
}

function lessonBlocks(content) {
  return contentText(content).split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function formatDate(value, fallback = "No due date") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
}

function isSecurityCourse(course) {
  return String(course?.category || "").toLowerCase() === "security_awareness";
}

function isCompleted(course) {
  return String(course?.assignment?.status || course?.status || "").toLowerCase() === "completed";
}

function CourseStatusBadge({ course }) {
  if (course?.archived) return <Badge variant="outline">Archived</Badge>;
  const completed = isCompleted(course);
  const published = course?.published !== false && course?.status !== "draft";
  if (completed) return <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200"><CheckCircle2 className="mr-1 h-3 w-3" />Complete</Badge>;
  if (!published) return <Badge variant="outline" className="border-amber-400/30 bg-amber-400/[0.08] text-amber-200">Draft</Badge>;
  return <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/[0.08] text-cyan-200">Assigned</Badge>;
}

function CourseCard({ course, onOpen, onEdit, onAssign, admin = false }) {
  const security = isSecurityCourse(course);
  const assignment = course.assignment || {};
  const blocks = lessonBlocks(course.content);
  return <Card className={`group overflow-hidden border-border/70 bg-card/85 transition hover:-translate-y-0.5 ${security ? "hover:border-emerald-400/35" : "hover:border-violet-400/35"}`} data-testid={`academy-course-${course.id}`}>
    <CardHeader className="border-b border-border/60 pb-3">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${security ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300" : "border-violet-400/25 bg-violet-400/[0.08] text-violet-300"}`}>
          {security ? <ShieldCheck className="h-4.5 w-4.5" /> : <BookOpenCheck className="h-4.5 w-4.5" />}
        </span>
        <CourseStatusBadge course={course} />
      </div>
      <CardTitle className="mt-3 text-base">{course.title || "Untitled course"}</CardTitle>
      <p className="min-h-10 text-xs leading-5 text-muted-foreground">{course.description || "No learner summary has been provided yet."}</p>
    </CardHeader>
    <CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{Number(course.estimated_minutes || 0) || "—"} min</span>
        <span className="inline-flex items-center gap-1"><FilePenLine className="h-3.5 w-3.5" />v{course.version || 1}</span>
        <Badge variant="outline" className="h-5 text-[9px]">{security ? "Security awareness" : "Academy"}</Badge>
        {course.required || assignment.required ? <Badge variant="outline" className="h-5 border-amber-400/25 text-[9px] text-amber-200">Required</Badge> : null}
      </div>
      {!admin && assignment.due_at ? <p className="text-[11px] text-muted-foreground">Due {formatDate(assignment.due_at)}</p> : null}
      {admin ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onEdit(course)} data-testid={`academy-edit-course-${course.id}`}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button size="sm" variant="outline" onClick={() => onAssign(course)} data-testid={`academy-assign-course-${course.id}`}><UsersRound className="mr-1.5 h-3.5 w-3.5" />Assign</Button></div> : <Button size="sm" className="w-full" variant={isCompleted(course) ? "outline" : "default"} onClick={() => onOpen(course)} data-testid={`academy-open-course-${course.id}`}>{isCompleted(course) ? "Review course" : "Start course"}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>}
      {admin && blocks.length ? <p className="text-[11px] text-muted-foreground">{blocks.length} lesson block{blocks.length === 1 ? "" : "s"} · {course.published ? "Published" : "Not visible to learners"}</p> : null}
    </CardContent>
  </Card>;
}

function EmptyState({ title, description, action }) {
  return <Card className="border-dashed border-border/80 bg-muted/[0.08]"><CardContent className="px-6 py-10 text-center"><GraduationCap className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>{action ? <div className="mt-4">{action}</div> : null}</CardContent></Card>;
}

export default function AcademyCoursesWorkspace({ token, isAdmin }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [learnerCourses, setLearnerCourses] = useState([]);
  const [adminCourses, setAdminCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [learnerError, setLearnerError] = useState("");
  const [studioError, setStudioError] = useState("");
  const [tab, setTab] = useState("learning");
  const [openCourse, setOpenCourse] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [answers, setAnswers] = useState({});
  const [editing, setEditing] = useState(null);
  const [courseForm, setCourseForm] = useState(() => emptyCourse());
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [assignmentInfo, setAssignmentInfo] = useState(null);
  const [selectedLearnerIds, setSelectedLearnerIds] = useState(new Set());
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentRequired, setAssignmentRequired] = useState(true);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [previewingTemplate, setPreviewingTemplate] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);
  const [instantiatingId, setInstantiatingId] = useState(null);

  const loadCourses = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setLearnerError("");
    setStudioError("");
    const [learnerResult, studioResult] = await Promise.allSettled([
      axios.get(`${API}/academy/me`, { headers }),
      isAdmin ? axios.get(`${API}/academy/admin/courses`, { headers }) : Promise.resolve(null),
    ]);
    if (learnerResult.status === "fulfilled") {
      setLearnerCourses(courseRows(learnerResult.value.data).map(learnerCourse));
    } else {
      setLearnerError(learnerResult.reason?.response?.data?.detail || "Nexus could not load your assigned courses. No learning progress was changed.");
    }
    if (isAdmin && studioResult.status === "fulfilled") {
      setAdminCourses(courseRows(studioResult.value?.data));
    } else if (isAdmin && studioResult.status === "rejected") {
      setStudioError(studioResult.reason?.response?.data?.detail || "Nexus could not load the authoring library. Existing course state was not changed.");
    }
    setLoading(false);
    setRefreshing(false);
  }, [headers, isAdmin]);

  useEffect(() => { loadCourses(); }, [loadCourses]);
  useEffect(() => { if (!isAdmin && tab === "studio") setTab("learning"); }, [isAdmin, tab]);
  useEffect(() => {
    if (!isAdmin) return;
    axios.get(`${API}/academy/admin/templates`, { headers })
      .then((response) => { setTemplates(response.data?.templates || []); setTemplatesError(false); })
      .catch(() => { setTemplates([]); setTemplatesError(true); });
  }, [headers, isAdmin]);

  const securityCourses = useMemo(() => learnerCourses.filter(isSecurityCourse), [learnerCourses]);
  const academyCourses = useMemo(() => learnerCourses.filter((course) => !isSecurityCourse(course)), [learnerCourses]);
  const completedCount = learnerCourses.filter(isCompleted).length;
  const completionPercent = learnerCourses.length ? Math.round((completedCount / learnerCourses.length) * 100) : 0;
  const technicians = useMemo(() => Array.from(new Map(
    (assignmentInfo?.learners || [])
      .filter((member) => member?.id)
      .map((member) => [String(member.id), { id: String(member.id), name: member.name || "Technician" }]),
  ).values()), [assignmentInfo]);

  const beginCourse = (course) => {
    setOpenCourse(course);
    setAcknowledged(false);
    setAnswers({});
  };

  const completeCourse = async () => {
    if (!openCourse || !acknowledged) return;
    setCompleting(true);
    try {
      const response = await axios.post(`${API}/academy/assignments/${encodeURIComponent(openCourse.assignment.id)}/complete`, { acknowledged: true, answers: Object.entries(answers).map(([question_id, selected_option]) => ({ question_id, selected_option })) }, { headers });
      const result = response.data || {};
      const updated = learnerCourse({ course: result.course || openCourse, assignment: result.assignment || openCourse.assignment });
      setLearnerCourses((current) => current.map((course) => (course.assignment.id === updated.assignment.id ? updated : course)));
      setOpenCourse(updated);
      toast.success(result.changed === false ? "Your Academy attestation is already retained" : "Academy attestation retained");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Nexus could not retain this Academy attestation");
    } finally {
      setCompleting(false);
    }
  };

  const beginCreate = (category = "academy") => {
    setEditing({ mode: "create" });
    setCourseForm(emptyCourse(category));
  };

  const beginEdit = (course) => {
    setEditing(course);
    setCourseForm({
      title: course.title || "",
      description: course.description || "",
      category: isSecurityCourse(course) ? "security_awareness" : "academy",
      content: contentText(course.content),
      estimated_minutes: Number(course.estimated_minutes || 10),
      required: Boolean(course.required),
      published: Boolean(course.published),
      archived: Boolean(course.archived),
      assessment: course.assessment || [],
      passing_score: course.passing_score || 100,
    });
  };

  const openTemplatePreview = async (templateId) => {
    setPreviewingTemplate(true);
    setPreviewTemplate(null);
    try {
      const response = await axios.get(`${API}/academy/admin/templates/${encodeURIComponent(templateId)}`, { headers });
      setPreviewTemplate(response.data?.template || null);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Nexus could not load this training template");
    } finally {
      setPreviewingTemplate(false);
    }
  };

  const createFromTemplate = async (templateId) => {
    setInstantiatingId(templateId);
    try {
      const response = await axios.post(`${API}/academy/admin/templates/${encodeURIComponent(templateId)}/instantiate`, {}, { headers });
      const course = response.data?.course;
      if (course) {
        beginEdit(course);
        toast.success("Draft created from template — customise every detail, then publish");
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Nexus could not create a draft from this template");
    } finally {
      setInstantiatingId(null);
    }
  };

  const saveCourse = async () => {
    const title = courseForm.title.trim();
    if (!title) {
      toast.error("Give this course a clear title before saving");
      return;
    }
    const payload = {
      title,
      description: courseForm.description.trim(),
      category: courseForm.category,
      content: courseForm.content.trim(),
      estimated_minutes: Math.max(1, Number.parseInt(courseForm.estimated_minutes, 10) || 1),
      required: Boolean(courseForm.required),
      published: Boolean(courseForm.published),
      archived: Boolean(courseForm.archived),
      assessment: courseForm.assessment,
      passing_score: Number(courseForm.passing_score),
    };
    if (editing?.id && editing?.version !== undefined) payload.expected_version = editing.version;
    setSaving(true);
    try {
      const response = editing?.id
        ? await axios.put(`${API}/academy/admin/courses/${encodeURIComponent(editing.id)}`, payload, { headers })
        : await axios.post(`${API}/academy/admin/courses`, payload, { headers });
      const saved = response.data?.course;
      setAdminCourses((current) => {
        if (!saved) return current;
        return editing?.id ? current.map((course) => (course.id === saved.id ? saved : course)) : [saved, ...current];
      });
      setEditing(null);
      toast.success(editing?.id ? "Course changes saved as a new reviewed version" : "Academy course created");
      await loadCourses({ background: true });
    } catch (error) {
      const raw = error?.response?.data?.detail;
      const detail = Array.isArray(raw) ? raw.map((item) => item.msg).join(". ") : raw || "Nexus could not save this course";
      toast.error(detail);
      if (error?.response?.status === 409) await loadCourses({ background: true });
    } finally {
      setSaving(false);
    }
  };

  const openAssignments = async (course) => {
    setAssigning(course);
    setAssignmentInfo({ loading: true, assignments: [], summary: null });
    setSelectedLearnerIds(new Set());
    setAssignmentDueAt("");
    setAssignmentRequired(course.required !== false);
    try {
      const response = await axios.get(`${API}/academy/admin/courses/${encodeURIComponent(course.id)}/assignments`, { headers });
      setAssignmentInfo({ loading: false, assignments: Array.isArray(response.data?.assignments) ? response.data.assignments : [], learners: response.data?.learners || [], summary: response.data?.summary || null, currentVersion: response.data?.current_version, possiblyTruncated: response.data?.possibly_truncated });
    } catch (error) {
      setAssignmentInfo({ loading: false, assignments: [], summary: null, error: error?.response?.data?.detail || "Nexus could not load course assignments." });
    }
  };

  const toggleLearner = (learnerId, selected) => {
    setSelectedLearnerIds((current) => {
      const next = new Set(current);
      if (selected) next.add(learnerId); else next.delete(learnerId);
      return next;
    });
  };

  const saveAssignments = async () => {
    if (!assigning || selectedLearnerIds.size === 0) {
      toast.error("Choose at least one technician to assign this course");
      return;
    }
    setSavingAssignments(true);
    try {
      const response = await axios.post(`${API}/academy/admin/courses/${encodeURIComponent(assigning.id)}/assignments`, {
        learner_ids: Array.from(selectedLearnerIds),
        due_at: assignmentDueAt || null,
        required: assignmentRequired,
      }, { headers });
      const created = Number(response.data?.created || 0);
      const existing = Number(response.data?.existing || 0);
      toast.success(created ? `${created} course assignment${created === 1 ? "" : "s"} created${existing ? `; ${existing} already existed` : ""}` : "Those course assignments already exist");
      setAssigning(null);
      await loadCourses({ background: true });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Nexus could not create these course assignments");
    } finally {
      setSavingAssignments(false);
    }
  };

  const learnerContent = (courses, emptyTitle, emptyDescription) => courses.length
    ? <div className="grid gap-4 xl:grid-cols-3">{courses.map((course) => <CourseCard key={course.assignment?.id || course.id} course={course} onOpen={beginCourse} />)}</div>
    : <EmptyState title={emptyTitle} description={emptyDescription} />;

  return <section className="space-y-4" aria-labelledby="academy-courses-title" data-testid="academy-courses-workspace">
    <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Courses and security awareness</p>
        <h2 id="academy-courses-title" className="mt-1 text-lg font-semibold">Build capability before the customer moment</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Nexus retains a deliberate learner attestation against the published course version. It never substitutes for ticket, approval, change, remote-session or incident evidence.</p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0 rounded-xl" onClick={() => loadCourses({ background: true })} disabled={refreshing} data-testid="academy-refresh-courses"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh courses</Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="border-violet-400/20 bg-violet-400/[0.035]"><CardContent className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">Assigned to me</p><p className="mt-1 text-xl font-semibold">{learnerCourses.length}</p></CardContent></Card>
      <Card className="border-emerald-400/20 bg-emerald-400/[0.035]"><CardContent className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Completed</p><p className="mt-1 text-xl font-semibold">{completedCount}</p></CardContent></Card>
      <Card className="border-cyan-400/20 bg-cyan-400/[0.035]"><CardContent className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">Learning progress</p><p className="mt-1 text-xl font-semibold">{completionPercent}%</p><Progress value={completionPercent} className="mt-2 h-1.5" /></CardContent></Card>
    </div>

    {learnerError ? <Card className="border-amber-400/25 bg-amber-400/[0.04]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted-foreground">{learnerError}</p><Button size="sm" variant="outline" onClick={() => loadCourses({ background: true })}>Retry safely</Button></CardContent></Card> : null}

    {isAdmin && <Button size="sm" variant="outline" disabled={saving} onClick={async () => { setSaving(true); try { const result = await axios.post(`${API}/academy/admin/security-awareness-starter`, {}, { headers }); await loadCourses({ background: true }); setTab("studio"); beginEdit(result.data.course); } catch { toast.error("Could not load the security-awareness starter"); } finally { setSaving(false); } }}><ShieldCheck className="mr-2 h-4 w-4" />Open security-awareness starter</Button>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto p-1 sm:w-auto">
        <TabsTrigger value="learning" className="gap-1.5" data-testid="academy-learning-tab"><GraduationCap className="h-3.5 w-3.5" />My learning</TabsTrigger>
        <TabsTrigger value="security" className="gap-1.5" data-testid="academy-security-tab"><ShieldCheck className="h-3.5 w-3.5" />Security awareness</TabsTrigger>
        {isAdmin ? <TabsTrigger value="studio" className="gap-1.5" data-testid="academy-studio-tab"><FilePenLine className="h-3.5 w-3.5" />Course studio</TabsTrigger> : null}
      </TabsList>

      <TabsContent value="learning" className="mt-4">
        {loading ? <Card><CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading assigned courses…</CardContent></Card> : learnerContent(academyCourses, "No Academy courses are assigned yet", "When an administrator publishes and assigns a capability course, it will appear here with its due date and version.")}
      </TabsContent>

      <TabsContent value="security" className="mt-4 space-y-4">
        <Card className="overflow-hidden border-emerald-400/20 bg-[radial-gradient(circle_at_88%_0%,rgba(16,185,129,0.14),transparent_35%),linear-gradient(125deg,rgba(9,26,24,0.88),rgba(15,19,33,0.88))]"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Nexus security awareness</p><p className="mt-1 text-base font-semibold">Practical habits, taught in your own service context</p><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Use internal courses to teach how your team verifies identity, reports suspicious requests and preserves evidence. This is a learning program—not a simulated campaign result or a customer-security assertion.</p></div>{isAdmin ? <Button variant="outline" className="shrink-0 border-emerald-400/30" onClick={() => beginCreate("security_awareness")} data-testid="academy-create-security-course"><Plus className="mr-1.5 h-3.5 w-3.5" />Create awareness course</Button> : null}</CardContent></Card>
        {loading ? <Card><CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading awareness training…</CardContent></Card> : learnerContent(securityCourses, "No security-awareness course is assigned", "Your service manager can publish an internal security-awareness lesson and assign it to you here. Nexus will retain an attestation only after you review it.")}
      </TabsContent>

      {isAdmin ? <TabsContent value="studio" className="mt-4 space-y-4">
        <Card className="border-violet-400/20 bg-violet-400/[0.035]"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Course studio</p><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Create a clear internal lesson, keep it in draft while it is reviewed, then publish and explicitly assign it to stable Nexus technician identities.</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => beginCreate("security_awareness")}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Security course</Button><Button size="sm" onClick={() => beginCreate()} data-testid="academy-create-course"><Plus className="mr-1.5 h-3.5 w-3.5" />New course</Button></div></CardContent></Card>
        <Card className="overflow-hidden border-cyan-400/20 bg-[radial-gradient(circle_at_92%_0%,rgba(34,211,238,0.12),transparent_38%),linear-gradient(125deg,rgba(10,20,28,0.92),rgba(15,19,33,0.88))]">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Training template library</p>
                <p className="mt-1 text-base font-semibold">Start from proven MSP training programs</p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Modelled on how leading MSP tools structure training — story-driven security-awareness episodes with knowledge checks, and role-based capability tracks (client onboarding, service desk triage, patch management, billing reconciliation). Every template becomes a fully customisable draft.</p>
              </div>
              <Badge variant="outline" className="shrink-0 border-cyan-400/25 bg-cyan-400/[0.06] text-cyan-100"><Library className="mr-1.5 h-3 w-3" />{templates.length} templates</Badge>
            </div>
            {templates.length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                  <div key={template.id} className="group flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 transition hover:-translate-y-0.5 hover:border-cyan-400/30 hover:bg-white/[0.04]" data-testid={`academy-template-${template.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className={template.track === "Security awareness" ? "border-emerald-400/25 bg-emerald-400/[0.07] text-[9px] text-emerald-200" : "border-violet-400/25 bg-violet-400/[0.07] text-[9px] text-violet-200"}>{template.track}</Badge>
                      <span className="text-[9px] text-muted-foreground">{template.estimated_minutes} min · {template.difficulty}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-zinc-100">{template.name}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{template.tagline}</p>
                    <p className="mt-2 text-[9px] text-muted-foreground">{template.module_count} modules · {template.assessment_count} knowledge checks · for {template.roles.slice(0, 2).join(", ")}</p>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 flex-1 border-white/[0.12] text-[11px]" onClick={() => openTemplatePreview(template.id)} data-testid={`academy-template-preview-${template.id}`}><Eye className="mr-1 h-3 w-3" />Preview</Button>
                      <Button size="sm" className="h-7 flex-1 text-[11px]" onClick={() => createFromTemplate(template.id)} disabled={instantiatingId === template.id} data-testid={`academy-template-use-${template.id}`}>
                        {instantiatingId === template.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}Use template
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3"><p className="text-xs text-muted-foreground">{templatesError ? "Nexus could not load the training template library. Your existing courses were not changed." : "The template library is loading…"}</p>{templatesError ? <Button size="sm" variant="outline" onClick={() => { setTemplatesError(false); axios.get(`${API}/academy/admin/templates`, { headers }).then((response) => setTemplates(response.data?.templates || [])).catch(() => setTemplatesError(true)); }}>Retry</Button> : null}</div>
            )}
          </CardContent>
        </Card>
        {studioError ? <Card className="border-amber-400/25 bg-amber-400/[0.04]"><CardContent className="flex items-center justify-between gap-3 p-4"><p className="text-xs text-muted-foreground">{studioError}</p><Button size="sm" variant="outline" onClick={() => loadCourses({ background: true })}>Retry</Button></CardContent></Card> : null}
        {loading ? <Card><CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the course library…</CardContent></Card> : adminCourses.length ? <div className="grid gap-4 xl:grid-cols-3">{adminCourses.map((course) => <CourseCard key={course.id} course={course} admin onEdit={beginEdit} onAssign={openAssignments} />)}</div> : <EmptyState title="Your Academy library is ready for its first course" description="Start with an internal security-awareness lesson or a capability course. Publishing does not assign the course automatically." action={<Button size="sm" onClick={() => beginCreate()}><Plus className="mr-1.5 h-3.5 w-3.5" />Create the first course</Button>} />}
      </TabsContent> : null}
    </Tabs>

    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}>
      <NexusWorkflowDialog
        eyebrow="Training template · preview"
        title={previewTemplate?.name || "Training template"}
        description={previewTemplate?.tagline || ""}
        icon={LayoutTemplate}
        tone={previewTemplate?.track === "Security awareness" ? "emerald" : "violet"}
        className="max-w-2xl"
        contentClassName="space-y-4"
        data-testid="academy-template-preview-dialog"
        footer={<><Button variant="ghost" onClick={() => setPreviewTemplate(null)}>Close</Button><Button onClick={() => { const id = previewTemplate?.id; setPreviewTemplate(null); if (id) createFromTemplate(id); }} disabled={!previewTemplate || instantiatingId === previewTemplate?.id} data-testid="academy-template-use-from-preview"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Use this template</Button></>}
      >
        {previewingTemplate ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : previewTemplate ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={previewTemplate.track === "Security awareness" ? "border-emerald-400/25 text-emerald-200" : "border-violet-400/25 text-violet-200"}>{previewTemplate.track}</Badge>
              <Badge variant="outline">{previewTemplate.difficulty}</Badge>
              <Badge variant="outline">{previewTemplate.estimated_minutes} minutes</Badge>
              <Badge variant="outline">Pass mark {previewTemplate.passing_score}%</Badge>
              {previewTemplate.required ? <Badge variant="outline" className="border-amber-400/30 text-amber-200">Required</Badge> : null}
            </div>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Module outline</p>
              <div className="mt-2 space-y-2">
                {(previewTemplate.modules || []).map((module, index) => (
                  <div key={`${module.title}-${index}`} className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
                    <p className="text-xs font-semibold">{index + 1}. {module.title}</p>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-muted-foreground">{module.body}</p>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Knowledge check ({(previewTemplate.assessment_prompts || []).length} questions)</p>
              <ul className="mt-2 space-y-1.5">
                {(previewTemplate.assessment_prompts || []).map((prompt, index) => (
                  <li key={index} className="rounded-lg border border-border/60 bg-muted/[0.08] px-3 py-2 text-[11px] leading-5">{prompt}</li>
                ))}
              </ul>
            </section>
            <p className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-2 text-[10px] leading-4 text-muted-foreground">Inspired by {previewTemplate.inspired_by}. Instantiating creates an editable draft course — rewrite any module, question, timing and pass mark before publishing.</p>
          </>
        ) : null}
      </NexusWorkflowDialog>
    </Dialog>

    <Dialog open={Boolean(openCourse)} onOpenChange={(open) => { if (!open) setOpenCourse(null); }}>
      {openCourse ? <NexusWorkflowDialog eyebrow={isSecurityCourse(openCourse) ? "Nexus security awareness" : "Nexus Academy"} title={openCourse.title || "Academy course"} description={openCourse.description || "Review the internal standard, then make a deliberate learning attestation."} icon={isSecurityCourse(openCourse) ? ShieldCheck : BookOpenCheck} tone={isSecurityCourse(openCourse) ? "emerald" : "violet"} className="max-w-3xl" contentClassName="space-y-5" data-testid="academy-course-player" footer={<><Button variant="ghost" onClick={() => setOpenCourse(null)}>Close</Button>{isCompleted(openCourse) ? <Button variant="outline" onClick={() => setOpenCourse(null)}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Attestation retained</Button> : <Button onClick={completeCourse} disabled={!acknowledged || completing}>{completing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundCheck className="mr-2 h-4 w-4" />}Retain my attestation</Button>}</>}>
        <div className="flex flex-wrap items-center gap-2"><CourseStatusBadge course={openCourse} /><Badge variant="outline">v{openCourse.version || 1}</Badge>{openCourse.assignment?.due_at ? <Badge variant="outline">Due {formatDate(openCourse.assignment.due_at)}</Badge> : null}<span className="text-xs text-muted-foreground">{Number(openCourse.estimated_minutes || 0) || "—"} min estimated</span></div>
        <section className="rounded-xl border border-border/70 bg-muted/[0.1] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lesson</p><div className="mt-3 space-y-4">{lessonBlocks(openCourse.content).length ? lessonBlocks(openCourse.content).map((block, index) => <p key={`${index}-${block.slice(0, 16)}`} className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{block}</p>) : <p className="text-sm text-muted-foreground">This course does not have lesson content yet. Ask an administrator to complete the draft before it is assigned.</p>}</div></section>
        {!isCompleted(openCourse) && (openCourse.assessment || []).map((question) => <fieldset key={question.id} className="space-y-3 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-semibold">{question.prompt}</legend>{question.options.map((option, index) => <label key={index} className="flex items-center gap-3 text-sm"><input type="radio" name={question.id} checked={answers[question.id] === index} onChange={() => setAnswers((current) => ({ ...current, [question.id]: index }))} />{option}</label>)}</fieldset>)}
        <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"><p className="text-xs font-semibold">Learning evidence</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Your completion records the assigned version, time and knowledge-check result. Required score: {openCourse.passing_score || 100}%.</p></section>
        {!isCompleted(openCourse) ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-400/25 bg-violet-400/[0.045] p-4"><Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(Boolean(value))} aria-label={`Acknowledge ${openCourse.title}`} /><span className="text-sm leading-6"><span className="font-medium">I have reviewed this course and understand the standard.</span><span className="mt-1 block text-xs text-muted-foreground">Nexus will retain this self-attestation against the published version. I will use the owning workflow for real work.</span></span></label> : <div className="flex gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><div><p className="text-sm font-medium">Attestation retained</p><p className="mt-1 text-xs text-muted-foreground">Completed {formatDate(openCourse.assignment?.completed_at, "previously")}. Revisit this version whenever you need a refresher.</p></div></div>}
      </NexusWorkflowDialog> : null}
    </Dialog>

    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
      {editing ? <NexusWorkflowDialog eyebrow="Nexus Academy · course studio" title={editing.id ? "Edit course" : "Create course"} description="Course content is versioned. Publish only when the lesson is ready for learners, then make assignment deliberate." icon={FilePenLine} tone="violet" className="max-w-3xl" contentClassName="space-y-5" data-testid="academy-course-editor" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveCourse} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePenLine className="mr-2 h-4 w-4" />}{editing.id ? "Save course" : "Create course"}</Button></>}>
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]"><div className="space-y-2"><Label htmlFor="academy-course-title">Course title</Label><Input id="academy-course-title" value={courseForm.title} maxLength={160} onChange={(event) => setCourseForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Secure remote-support habits" data-testid="academy-course-title-input" /></div><div className="space-y-2"><Label>Course type</Label><Select value={courseForm.category} onValueChange={(category) => setCourseForm((current) => ({ ...current, category }))}><SelectTrigger data-testid="academy-course-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="academy">Academy capability</SelectItem><SelectItem value="security_awareness">Security awareness</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label htmlFor="academy-course-description">Learner summary</Label><Textarea id="academy-course-description" rows={3} value={courseForm.description} maxLength={600} onChange={(event) => setCourseForm((current) => ({ ...current, description: event.target.value }))} placeholder="State the operational outcome, audience and why it matters." /></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="academy-course-minutes">Estimated minutes</Label><Input id="academy-course-minutes" type="number" min="1" max="480" value={courseForm.estimated_minutes} onChange={(event) => setCourseForm((current) => ({ ...current, estimated_minutes: event.target.value }))} /></div><div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3"><p className="text-xs font-semibold">Authoring guidance</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">Use short, task-specific paragraphs. Do not include passwords, customer secrets or instructions that bypass Nexus approval and verification controls.</p></div></div>
        <div className="space-y-2"><Label htmlFor="academy-course-content">Lesson content</Label><Textarea id="academy-course-content" rows={12} value={courseForm.content} onChange={(event) => setCourseForm((current) => ({ ...current, content: event.target.value }))} placeholder="Write the lesson in plain language. Separate sections with blank lines." data-testid="academy-course-content-input" /><p className="text-[11px] text-muted-foreground">Blank lines become readable lesson sections for learners. Nexus renders this as text, not executable or rich content.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-3"><Checkbox checked={courseForm.required} onCheckedChange={(value) => setCourseForm((current) => ({ ...current, required: Boolean(value) }))} /><span className="text-sm"><span className="font-medium">Required when assigned</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Required status is visible to the learner and retained with their assignment.</span></span></label><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.04] p-3"><Checkbox checked={courseForm.published} onCheckedChange={(value) => setCourseForm((current) => ({ ...current, published: Boolean(value) }))} /><span className="text-sm"><span className="font-medium">Publish to assigned learners</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Keep unchecked for review. Publishing does not auto-assign the course.</span></span></label></div>
        <section className="space-y-3"><div className="flex items-center justify-between"><Label>Knowledge check</Label><Button size="sm" variant="outline" disabled={courseForm.assessment.length >= 30} onClick={() => setCourseForm((current) => ({ ...current, assessment: [...current.assessment, { id: crypto.randomUUID(), prompt: "", options: ["", ""], correct_option: 0 }] }))}>Add question</Button></div><p className="text-xs text-muted-foreground">Security-awareness courses require a knowledge check before publication.</p>{courseForm.assessment.map((question, questionIndex) => <div key={question.id} className="space-y-3 rounded-xl border border-border p-4"><Input aria-label={`Question ${questionIndex + 1}`} placeholder="Question" value={question.prompt} onChange={(e) => setCourseForm((current) => ({ ...current, assessment: current.assessment.map((q, i) => i === questionIndex ? { ...q, prompt: e.target.value } : q) }))} />{question.options.map((option, optionIndex) => <div key={optionIndex} className="flex items-center gap-2"><input type="radio" aria-label={`Correct answer ${optionIndex + 1} for question ${questionIndex + 1}`} name={`correct-${question.id}`} checked={question.correct_option === optionIndex} onChange={() => setCourseForm((current) => ({ ...current, assessment: current.assessment.map((q, i) => i === questionIndex ? { ...q, correct_option: optionIndex } : q) }))} /><Input aria-label={`Answer ${optionIndex + 1}`} placeholder={`Answer ${optionIndex + 1}`} value={option} onChange={(e) => setCourseForm((current) => ({ ...current, assessment: current.assessment.map((q, i) => i === questionIndex ? { ...q, options: q.options.map((o, j) => j === optionIndex ? e.target.value : o) } : q) }))} /></div>)}<div className="flex gap-2"><Button size="sm" variant="outline" disabled={question.options.length >= 6} onClick={() => setCourseForm((current) => ({ ...current, assessment: current.assessment.map((q, i) => i === questionIndex ? { ...q, options: [...q.options, ""] } : q) }))}>Add answer</Button><Button size="sm" variant="ghost" onClick={() => setCourseForm((current) => ({ ...current, assessment: current.assessment.filter((_, i) => i !== questionIndex) }))}>Remove question</Button></div><p className="text-xs text-muted-foreground">Select the circle beside the correct answer.</p></div>)}<Label htmlFor="academy-pass-score">Passing score (%)</Label><Input id="academy-pass-score" type="number" min="1" max="100" value={courseForm.passing_score} onChange={(e) => setCourseForm((current) => ({ ...current, passing_score: e.target.value }))} /></section>
        {editing.id ? <label className="flex items-center gap-3 rounded-xl border border-border p-3"><Archive className="h-4 w-4" /><Checkbox checked={courseForm.archived} onCheckedChange={(value) => setCourseForm((current) => ({ ...current, archived: Boolean(value) }))} /><span className="text-sm">Archive course (retain assigned learning and history)</span></label> : null}
      </NexusWorkflowDialog> : null}
    </Dialog>

    <Dialog open={Boolean(assigning)} onOpenChange={(open) => { if (!open) setAssigning(null); }}>
      {assigning ? <NexusWorkflowDialog eyebrow="Nexus Academy · deliberate assignment" title={`Assign ${assigning.title || "course"}`} description="Choose the technicians who need this course. Existing assignments remain intact; this action only adds the selected people." icon={UsersRound} tone="cyan" className="max-w-3xl" contentClassName="space-y-5" data-testid="academy-assignment-editor" footer={<><Button variant="ghost" onClick={() => setAssigning(null)}>Cancel</Button><Button onClick={saveAssignments} disabled={savingAssignments || assignmentInfo?.loading || !technicians.length || !selectedLearnerIds.size || !assigning.published || assigning.archived}>{savingAssignments ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UsersRound className="mr-2 h-4 w-4" />}Assign selected</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Assigned · current version</p><p className="mt-1 text-lg font-semibold">{assignmentInfo?.loading ? "…" : assignmentInfo?.summary?.assigned || 0}</p></div><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3"><p className="text-[10px] uppercase tracking-wide text-emerald-300">Completed</p><p className="mt-1 text-lg font-semibold">{assignmentInfo?.loading ? "…" : assignmentInfo?.summary?.completed || 0}</p></div><div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3"><p className="text-[10px] uppercase tracking-wide text-cyan-300">Selected now</p><p className="mt-1 text-lg font-semibold">{selectedLearnerIds.size}</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="academy-assignment-due">Due date <span className="text-muted-foreground">(optional)</span></Label><Input id="academy-assignment-due" type="date" value={assignmentDueAt} onChange={(event) => setAssignmentDueAt(event.target.value)} /></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2"><Checkbox checked={assignmentRequired} onCheckedChange={(value) => setAssignmentRequired(Boolean(value))} /><span className="text-sm">Required for selected learners</span></label></div>
        {assignmentInfo?.error ? <Card className="border-amber-400/25 bg-amber-400/[0.04]"><CardContent className="p-3 text-xs text-muted-foreground">{assignmentInfo.error}</CardContent></Card> : null}
        {!assigning.published || assigning.archived ? <p className="rounded-xl border border-amber-400/25 p-3 text-sm text-amber-200">Publish an active course before adding assignments. Learning history remains available below.</p> : null}
        {assignmentInfo?.summary?.overdue > 0 && <p className="text-sm text-amber-200">{assignmentInfo.summary.overdue} overdue assignment(s) for this version.</p>}
        {assignmentInfo?.possiblyTruncated && <p className="text-xs text-amber-200">Showing the first 2,000 assignments. Counts reflect the displayed records.</p>}
        <AcademyAssignmentEvidence assignments={assignmentInfo?.assignments} currentVersion={assignmentInfo?.currentVersion} />
        <section><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold">Technicians</p><p className="text-[11px] text-muted-foreground">Stable Nexus identities only</p></div>{assignmentInfo?.loading ? <div className="flex items-center gap-2 rounded-xl border border-border/70 p-5 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading assignments…</div> : technicians.length ? <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border/70 p-2">{technicians.map((technician) => { const existing = assignmentInfo?.assignments?.find((assignment) => String(assignment.learner_id) === technician.id && assignment.course_version === assignmentInfo.currentVersion); return <label key={technician.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/45"><Checkbox checked={selectedLearnerIds.has(technician.id)} onCheckedChange={(value) => toggleLearner(technician.id, Boolean(value))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{technician.name}</span><span className="block text-[11px] text-muted-foreground">{existing ? `Already ${existing.status || "assigned"}${existing.due_at ? ` · due ${formatDate(existing.due_at)}` : ""}` : "Not assigned yet"}</span></span>{existing ? <Badge variant="outline" className="text-[9px]">Existing</Badge> : null}</label>; })}</div> : <div className="rounded-xl border border-dashed border-border/80 p-5 text-center text-xs leading-5 text-muted-foreground">Nexus could not find technicians from the current readiness roster. Refresh Academy, then try again when the roster is available.</div>}</section>
      </NexusWorkflowDialog> : null}
    </Dialog>
  </section>;
}

export { contentText, isSecurityCourse, learnerCourse };
