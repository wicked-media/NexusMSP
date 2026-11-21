import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Star, XCircle } from "lucide-react";

const SHELL =
  "min-h-screen bg-zinc-950 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.10),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_50%)] flex items-center justify-center p-4";

const RATING_LABELS = {
  1: "Very dissatisfied",
  2: "Dissatisfied",
  3: "Neutral",
  4: "Satisfied",
  5: "Very satisfied",
};

/** Public, one-time response page for a ticket-linked CSAT survey. */
export default function CsatResponsePage() {
  const { surveyId } = useParams();
  const [state, setState] = useState("loading");
  const [survey, setSurvey] = useState(null);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API}/csat/${surveyId}/public`)
      .then(({ data }) => {
        if (cancelled) return;
        setSurvey(data);
        setState("form");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.detail || "This survey link is not available.");
        setState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  const submit = async () => {
    if (!score) {
      setError("Choose a rating from 1 to 5.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await axios.post(`${API}/csat/${surveyId}/respond`, { score, feedback });
      setState("done");
    } catch (err) {
      const status = err.response?.status;
      if (status === 404 || status === 409 || status === 410) {
        setError(err.response?.data?.detail || "This survey has already been answered.");
        setState("unavailable");
      } else {
        setError(err.response?.data?.detail || "Could not submit feedback. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") {
    return (
      <div className={SHELL}>
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className={SHELL} data-testid="csat-response-page">
        <Card className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-[linear-gradient(145deg,rgba(28,18,22,0.98),rgba(15,12,16,0.98))]">
          <CardContent className="py-10 text-center">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10">
              <XCircle className="w-8 h-8 text-rose-400" />
            </span>
            <h1 className="text-xl font-bold text-white">Survey unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              Survey links are single-use. Ask your service provider for a new link if you still need to share feedback.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className={SHELL} data-testid="csat-response-page">
        <Card className="w-full max-w-md rounded-2xl border border-emerald-400/25 bg-[linear-gradient(145deg,rgba(16,26,24,0.98),rgba(11,18,17,0.98))]">
          <CardContent className="py-10 text-center">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-500/10">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </span>
            <h1 className="text-xl font-bold text-white">Thank you for your feedback</h1>
            <p className="mt-2 text-sm text-muted-foreground" data-testid="csat-done">
              Your rating was recorded against the ticket and shared with the team that helped you.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const active = hover || score;

  return (
    <div className={SHELL} data-testid="csat-response-page">
      <Card className="w-full max-w-lg rounded-2xl border border-cyan-400/20 bg-[linear-gradient(145deg,rgba(16,24,30,0.98),rgba(11,16,20,0.98))]">
        <CardContent className="p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">NexusMSP service feedback</p>
          <h1 className="mt-2 text-2xl font-bold text-white">How did we do?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {survey?.ticket_number ? `Ticket ${survey.ticket_number}` : "Your support ticket"}
            {survey?.client_name ? ` · ${survey.client_name}` : ""}
          </p>

          <div className="mt-6" role="group" aria-label="Rate the service from 1 to 5">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`csat-star-${value}`}
                  aria-label={`${value} out of 5 — ${RATING_LABELS[value]}`}
                  aria-pressed={score === value}
                  onMouseEnter={() => setHover(value)}
                  onMouseLeave={() => setHover(0)}
                  onFocus={() => setHover(value)}
                  onBlur={() => setHover(0)}
                  onClick={() => {
                    setScore(value);
                    setError("");
                  }}
                  className="rounded-lg p-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  <Star
                    className={`h-9 w-9 ${value <= active ? "fill-amber-400 text-amber-400" : "text-zinc-600"}`}
                  />
                </button>
              ))}
            </div>
            <p className="mt-2 h-5 text-sm text-muted-foreground">
              {active ? RATING_LABELS[active] : "Select a rating"}
            </p>
          </div>

          <label htmlFor="csat-feedback" className="mt-4 block text-sm font-medium text-zinc-200">
            Anything you would like to add? <span className="text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="csat-feedback"
            value={feedback}
            maxLength={2000}
            rows={4}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What went well, or what could we do better?"
            className="mt-2"
          />

          {error ? (
            <p className="mt-3 text-sm text-rose-400" role="alert">
              {error}
            </p>
          ) : null}

          <Button className="mt-5 w-full" onClick={submit} disabled={busy || !score} data-testid="csat-submit">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send feedback
          </Button>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            This link is unique to your ticket and accepts one response. Your rating is stored with the ticket, not used for marketing.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
