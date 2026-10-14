import { useMemo, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { AcademyCertificateSheet } from "./AcademyCertificate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from "lucide-react";

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === "string" ? item : item?.body || item?.content || item?.title || "")).filter(Boolean).join("\n\n");
  }
  return "";
}

function lessonSections(content) {
  return contentText(content).split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function splitBlock(block) {
  const [first, ...rest] = block.split("\n");
  const body = rest.join("\n").trim();
  return body && first.trim().length <= 80 ? { title: first.trim(), body } : { title: "", body: block };
}

function formatDate(value, fallback = "—") {
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

const PHASES = [
  { id: "learn", label: "Lesson" },
  { id: "check", label: "Knowledge check" },
  { id: "attest", label: "Attestation" },
];

export default function AcademyCoursePlayerDialog({ course, token, onClose, onFinished }) {
  const completed = isCompleted(course);
  const sections = useMemo(() => lessonSections(course?.content), [course]);
  const questions = useMemo(() => (Array.isArray(course?.assessment) ? course.assessment : []), [course]);
  const [phase, setPhase] = useState(completed ? "review" : "learn");
  const [lessonStep, setLessonStep] = useState(0);
  const [questionStep, setQuestionStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [certificate, setCertificate] = useState(null);

  const totalSteps = sections.length + questions.length + 1;
  const stepsDone = phase === "learn" ? lessonStep
    : phase === "check" ? sections.length + questionStep
      : phase === "attest" ? sections.length + questions.length
        : totalSteps;
  const progress = totalSteps ? Math.round((stepsDone / totalSteps) * 100) : 100;
  const security = isSecurityCourse(course);
  const evidence = course?.assignment?.completion_evidence || null;

  const goLearn = () => { setPhase("learn"); setLessonStep(0); };
  const goCheck = () => { setPhase("check"); setQuestionStep(0); };

  const submit = async () => {
    if (!course?.assignment?.id || !acknowledged) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = {
        acknowledged: true,
        answers: Object.entries(answers).map(([question_id, selected_option]) => ({ question_id, selected_option })),
      };
      const response = await axios.post(`${API}/academy/assignments/${encodeURIComponent(course.assignment.id)}/complete`, payload, { headers: { Authorization: `Bearer ${token}` } });
      const result = response.data || {};
      setCertificate(result.certificate || null);
      setPhase("done");
      toast.success(result.changed === false ? "Your Academy attestation is already retained" : "Academy attestation retained");
      onFinished?.(result);
    } catch (error) {
      setSubmitError(error?.response?.data?.detail || "Nexus could not retain this Academy attestation");
      setPhase("failed");
    } finally {
      setSubmitting(false);
    }
  };

  const phaseIndex = PHASES.findIndex((entry) => entry.id === phase);

  const footer = (() => {
    if (phase === "review") return <Button variant="outline" onClick={onClose} data-testid="academy-player-close">Close</Button>;
    if (phase === "done") return (
      <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" onClick={() => window.print()} data-testid="academy-player-print"><Printer className="mr-1.5 h-3.5 w-3.5" />Print certificate</Button>
      </>
    );
    if (phase === "failed") return (
      <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" onClick={goLearn} data-testid="academy-player-review-lesson"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Review the lesson</Button>
        <Button onClick={goCheck} data-testid="academy-player-retry-check">Retry knowledge check<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
      </>
    );
    if (phase === "attest") return (
      <>
        <Button variant="ghost" onClick={() => setPhase("check")} disabled={submitting}>Back</Button>
        <Button onClick={submit} disabled={!acknowledged || submitting} data-testid="academy-player-submit">
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundCheck className="mr-2 h-4 w-4" />}Retain my attestation
        </Button>
      </>
    );
    const lastLesson = phase === "learn" && lessonStep >= sections.length - 1;
    const lastQuestion = phase === "check" && questionStep >= questions.length - 1;
    return (
      <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" onClick={() => (phase === "learn" ? setLessonStep((step) => Math.max(0, step - 1)) : setQuestionStep((step) => Math.max(0, step - 1)))} disabled={phase === "learn" ? lessonStep === 0 : questionStep === 0}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />Back
        </Button>
        <Button
          onClick={() => {
            if (phase === "learn") {
              if (lastLesson) { if (questions.length) { goCheck(); } else { setPhase("attest"); } } else setLessonStep((step) => step + 1);
            } else if (lastQuestion) {
              setPhase("attest");
            } else {
              setQuestionStep((step) => step + 1);
            }
          }}
          disabled={phase === "check" && answers[questions[questionStep]?.id] === undefined}
          data-testid="academy-player-next"
        >
          {lastLesson && !questions.length ? "Continue to attestation" : lastLesson ? "Start knowledge check" : lastQuestion ? "Continue to attestation" : "Next"}
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </>
    );
  })();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <NexusWorkflowDialog
        eyebrow={security ? "Nexus security awareness · course player" : "Nexus Academy · course player"}
        title={course?.title || "Academy course"}
        description={course?.description || "Review the internal standard, then make a deliberate learning attestation."}
        icon={security ? ShieldCheck : BookOpenCheck}
        tone={security ? "emerald" : "violet"}
        className="max-w-3xl"
        contentClassName="space-y-5"
        data-testid="academy-course-player"
        footer={footer}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">v{course?.version || 1}</Badge>
          {course?.assignment?.due_at ? <Badge variant="outline">Due {formatDate(course.assignment.due_at)}</Badge> : null}
          <span className="text-xs text-muted-foreground">{Number(course?.estimated_minutes || 0) || "—"} min estimated</span>
          {phaseIndex >= 0 && phase !== "review" ? (
            <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
              {PHASES.map((entry, index) => (
                <span key={entry.id} className={index <= phaseIndex ? "font-semibold text-foreground" : ""}>{index + 1}. {entry.label}</span>
              ))}
            </span>
          ) : null}
        </div>
        {phase !== "review" && phase !== "done" && phase !== "failed" ? <Progress value={progress} className="h-1.5" /> : null}

        {phase === "learn" ? (
          <section className="rounded-xl border border-border/70 bg-muted/[0.1] p-4" data-testid="academy-player-lesson">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lesson · section {lessonStep + 1} of {Math.max(sections.length, 1)}</p>
            {sections.length ? (() => {
              const block = splitBlock(sections[lessonStep] || "");
              return (
                <div className="mt-3 space-y-2">
                  {block.title ? <p className="text-sm font-semibold text-foreground">{block.title}</p> : null}
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{block.body}</p>
                </div>
              );
            })() : <p className="mt-3 text-sm text-muted-foreground">This course does not have lesson content yet. Ask an administrator to complete the draft before it is assigned.</p>}
          </section>
        ) : null}

        {phase === "check" ? (
          <fieldset className="space-y-3 rounded-xl border border-border p-4" data-testid="academy-player-question">
            <legend className="px-1 text-sm font-semibold">{questions[questionStep]?.prompt}</legend>
            <p className="px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Question {questionStep + 1} of {questions.length}</p>
            {(questions[questionStep]?.options || []).map((option, index) => (
              <label key={index} className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-sm hover:bg-muted/40">
                <input
                  type="radio"
                  name={questions[questionStep]?.id}
                  checked={answers[questions[questionStep]?.id] === index}
                  onChange={() => setAnswers((current) => ({ ...current, [questions[questionStep]?.id]: index }))}
                />
                {option}
              </label>
            ))}
          </fieldset>
        ) : null}

        {phase === "attest" ? (
          <>
            <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
              <p className="text-xs font-semibold">Learning evidence</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Your completion records the assigned version, time and knowledge-check result. Required score: {course?.passing_score || 100}%. {questions.length ? `You answered ${Object.keys(answers).length} of ${questions.length} questions.` : "This course uses an attestation without a knowledge check."}</p>
            </section>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-400/25 bg-violet-400/[0.045] p-4">
              <Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(Boolean(value))} aria-label={`Acknowledge ${course?.title}`} />
              <span className="text-sm leading-6">
                <span className="font-medium">I have reviewed this course and understand the standard.</span>
                <span className="mt-1 block text-xs text-muted-foreground">Nexus will retain this self-attestation against the published version. I will use the owning workflow for real work.</span>
              </span>
            </label>
          </>
        ) : null}

        {phase === "failed" ? (
          <section className="space-y-3 rounded-xl border border-rose-400/30 bg-rose-400/[0.05] p-4" data-testid="academy-player-failed">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
              <div>
                <p className="text-sm font-medium">Not passed yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{submitError || "Review the material and try again."}</p>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Your answers were not retained as completion evidence. Review the lesson, then take the knowledge check again.</p>
          </section>
        ) : null}

        {phase === "done" ? (
          <section className="space-y-3" data-testid="academy-player-done">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <div>
                <p className="text-sm font-medium">Attestation retained</p>
                <p className="mt-1 text-xs text-muted-foreground">Score {certificate?.score_percent ?? evidence?.score_percent ?? 0}% · completed {formatDate(certificate?.issued_at || course?.assignment?.completed_at, "just now")}. Revisit this version whenever you need a refresher.</p>
              </div>
            </div>
            <AcademyCertificateSheet certificate={certificate} />
          </section>
        ) : null}

        {phase === "review" ? (
          <>
            <section className="rounded-xl border border-border/70 bg-muted/[0.1] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lesson</p>
              <div className="mt-3 space-y-4">
                {sections.length ? sections.map((block, index) => {
                  const split = splitBlock(block);
                  return (
                    <div key={`${index}-${block.slice(0, 16)}`} className="space-y-1">
                      {split.title ? <p className="text-sm font-semibold text-foreground">{split.title}</p> : null}
                      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{split.body}</p>
                    </div>
                  );
                }) : <p className="text-sm text-muted-foreground">This course does not have lesson content.</p>}
              </div>
            </section>
            <div className="flex gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <div>
                <p className="text-sm font-medium">Attestation retained</p>
                <p className="mt-1 text-xs text-muted-foreground">Completed {formatDate(course?.assignment?.completed_at, "previously")}{evidence?.score_percent !== undefined ? ` · score ${evidence.score_percent}%` : ""}. Find your certificate under the Certificates tab.</p>
              </div>
            </div>
          </>
        ) : null}
      </NexusWorkflowDialog>
    </Dialog>
  );
}
