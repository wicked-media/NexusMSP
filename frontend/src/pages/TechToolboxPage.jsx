import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dices, Focus, Gamepad2, QrCode, IdCard, Trophy, CloudSun, Timer, Loader2, Download, Printer, Zap, Moon, Volume2, VolumeX,
  Languages, Network, ShieldCheck, Swords, Server, PartyPopper,
  Home, Beer, ListChecks, Brain, Gauge, ThumbsDown, FlaskConical,
  Siren, Radar, Lock, ArrowRightLeft, PiggyBank,
  Activity, Eye, History, Search, MapPin, CalendarClock, TrendingDown, Hammer, PanelRight,
  HelpCircle, BadgeCheck, Sparkles, BellOff, GitMerge, ClipboardCheck, Scale, ShieldAlert, MessageSquare,
  AlertTriangle, Sunrise, Sunset, BookOpen, Waypoints, Dna, Coins,
  Stethoscope, Crosshair, Radio, UserCheck, LifeBuoy,
} from "lucide-react";
import { playSound, isSoundEnabled, setSoundEnabled } from "@/lib/sounds";
import { buildTechCardSvg, techCardFilename } from "@/lib/techCard";

const WEATHER = {
  sunny: { icon: "☀️", label: "Sunny", tone: "text-amber-300" },
  cloudy: { icon: "⛅", label: "Cloudy", tone: "text-slate-300" },
  foggy: { icon: "🌫️", label: "Foggy", tone: "text-slate-400" },
  stormy: { icon: "⛈️", label: "Stormy", tone: "text-red-300" },
};

const WIN_KINDS = {
  critical: { icon: "🚨", label: "Critical closed" },
  sla: { icon: "⚡", label: "Fast save" },
  close: { icon: "✅", label: "Ticket closed" },
};

function Section({ icon: Icon, title, hint, children }) {
  return (
    <Card className="border-violet-500/20 bg-slate-900/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-violet-400" />{title}
        </CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ============== WHEEL OF TICKETS ==============

function WheelOfTickets() {
  const { token } = useAuth();
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const spin = async () => {
    setSpinning(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/wheel-spin`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
      playSound(data.ticket ? "spin" : "deny");
      if (data.ticket) toast.success(data.message);
      else toast(data.message);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The wheel is stuck");
    } finally {
      setSpinning(false);
    }
  };

  return (
    <Section icon={Dices} title="Wheel of Tickets" hint="Can't decide? The wheel assigns you the oldest unassigned open ticket in your scope. Every 5-spin streak earns bonus points.">
      <div className="flex items-center gap-4">
        <Button onClick={spin} disabled={spinning} data-testid="wheel-spin">
          {spinning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Dices className="mr-2 h-4 w-4" />}Spin the wheel
        </Button>
        {result?.wheel_streak > 0 && <Badge variant="outline" className="text-amber-300 border-amber-400/40">🔥 streak {result.wheel_streak}</Badge>}
        {result?.streak_bonus_points > 0 && <Badge className="bg-emerald-500/20 text-emerald-300">+{result.streak_bonus_points} bonus</Badge>}
      </div>
      {result?.ticket && (
        <div className="mt-4 rounded-lg border border-violet-400/30 bg-violet-500/10 p-3 text-sm" data-testid="wheel-result">
          <span className="font-mono text-violet-300">#{result.ticket.ticket_number}</span>{" "}
          <span className="font-medium">{result.ticket.title}</span>
          <span className="text-muted-foreground"> · {result.ticket.client_name} · {result.ticket.priority}</span>
        </div>
      )}
    </Section>
  );
}

// ============== FOCUS MODE ==============

function FocusMode() {
  const { token } = useAuth();
  const [focus, setFocus] = useState({ active: false });
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/tech-fun/focus`, { headers }).then(({ data }) => setFocus(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const start = async (minutes) => {
    try {
      const { data } = await axios.post(`${API}/tech-fun/focus`, { minutes }, { headers });
      setFocus(data);
      toast.success(`Going dark for ${minutes} minutes. Non-urgent pings can wait.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not start focus mode");
    }
  };

  const stop = async () => {
    try {
      const { data } = await axios.delete(`${API}/tech-fun/focus`, { headers });
      setFocus({ active: false });
      if (data.deep_work_points > 0) {
        playSound("coin");
        toast.success(`Focus session complete — +${data.deep_work_points} points for deep work.`);
      } else {
        toast("Focus session ended.");
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not end focus mode");
    }
  };

  return (
    <Section icon={Focus} title="Focus Mode" hint="Bounded quiet time. A completed 25+ minute session earns a small deep-work bonus once a day.">
      {focus.active ? (
        <div className="flex items-center gap-3">
          <Badge className="bg-indigo-500/20 text-indigo-300"><Moon className="mr-1 h-3 w-3" />Dark until {new Date(focus.focus_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Badge>
          <Button variant="outline" size="sm" onClick={stop} data-testid="focus-end">End session</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => start(25)} data-testid="focus-start-25"><Zap className="mr-1 h-3 w-3" />25 min</Button>
          <Button size="sm" variant="outline" onClick={() => start(60)}>60 min</Button>
          <Button size="sm" variant="outline" onClick={() => start(120)}>120 min</Button>
        </div>
      )}
    </Section>
  );
}

// ============== PING ARCADE ==============

function PingArcade() {
  const courtRef = useRef(null);
  const ballRef = useRef(null);
  const paddleRef = useRef(null);
  const stateRef = useRef({ x: 50, y: 30, vx: 0.6, vy: 0.45, score: 0, running: false, raf: 0 });
  const [rtt, setRtt] = useState(null);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);

  const measure = async () => {
    const started = performance.now();
    try {
      await axios.get(`${API}/health`, { headers: {} });
    } catch {
      /* even a failed call returns a usable round-trip time */
    }
    return Math.max(1, Math.round(performance.now() - started));
  };

  const startGame = async () => {
    const measured = await measure();
    setRtt(measured);
    const speed = 0.4 + Math.min(1.4, 24 / measured);
    const s = stateRef.current;
    s.x = 50; s.y = 30; s.vx = speed; s.vy = speed * 0.75; s.score = 0; s.running = true;
    setScore(0);
    setRunning(true);
    const step = () => {
      if (!s.running) return;
      s.x += s.vx;
      s.y += s.vy;
      if (s.x <= 2 || s.x >= 98) s.vx *= -1;
      if (s.y <= 2) s.vy *= -1;
      const paddle = paddleRef.current;
      const paddleX = paddle ? Number(paddle.dataset.x || 50) : 50;
      if (s.y >= 92 && s.y <= 96 && Math.abs(s.x - paddleX) < 12) {
        s.vy = -Math.abs(s.vy);
        s.score += 1;
        setScore(s.score);
      }
      if (s.y > 100) {
        s.running = false;
        setRunning(false);
        playSound("deny");
        toast(`Game over — ${s.score} bounces at ${measured}ms RTT.`);
        return;
      }
      if (ballRef.current) ballRef.current.style.transform = `translate(${s.x}%, ${s.y * 3}%)`;
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  };

  useEffect(() => () => { stateRef.current.running = false; cancelAnimationFrame(stateRef.current.raf); }, []);

  const movePaddle = (event) => {
    const court = courtRef.current;
    if (!court || !paddleRef.current) return;
    const rect = court.getBoundingClientRect();
    const x = Math.min(96, Math.max(4, ((event.clientX - rect.left) / rect.width) * 100));
    paddleRef.current.dataset.x = String(x);
    paddleRef.current.style.left = `${x}%`;
  };

  return (
    <Section icon={Gamepad2} title="Ping Arcade" hint="Paddle speed is driven by a real round-trip measurement against this Nexus API. Slow links, hard game.">
      <div ref={courtRef} onMouseMove={movePaddle} className="relative h-56 w-full overflow-hidden rounded-xl border border-violet-400/25 bg-gradient-to-b from-slate-900 to-indigo-950" data-testid="ping-arcade">
        <div ref={ballRef} className="absolute left-0 top-0 h-3 w-3 rounded-full bg-amber-300 shadow-lg shadow-amber-300/40" />
        <div ref={paddleRef} data-x="50" className="absolute bottom-2 h-2 w-24 -translate-x-1/2 rounded-full bg-violet-400" style={{ left: "50%" }} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={startGame} disabled={running} data-testid="ping-start">
          <Gamepad2 className="mr-1 h-3 w-3" />{running ? "Playing…" : "Play"}
        </Button>
        {rtt && <Badge variant="outline" className="text-sky-300 border-sky-400/40">RTT {rtt}ms</Badge>}
        <Badge variant="outline" className="text-amber-300 border-amber-400/40">{score} bounces</Badge>
      </div>
    </Section>
  );
}

// ============== QR LABEL PRINTER ==============

function LabelPrinter() {
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [qrUrl, setQrUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!url.trim()) {
      toast.error("Enter the device URL the label should encode");
      return;
    }
    setBusy(true);
    try {
      const response = await axios.get(`${API}/tech-fun/qr`, {
        params: { data: url.trim() },
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });
      setQrUrl(URL.createObjectURL(response.data));
      playSound("win");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not render the QR label");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={QrCode} title="Cable & device labels" hint="Printable QR labels that encode a device URL — stick one on a cable, rack unit or laptop lid.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Label text</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Core switch — comms room" className="mt-1" />
          <Label className="mt-3 block text-xs">Device URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`${window.location.origin}/devices/dev-1`} className="mt-1" />
          <Button size="sm" className="mt-3" onClick={generate} disabled={busy} data-testid="qr-generate">
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <QrCode className="mr-1 h-3 w-3" />}Generate label
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-violet-400/30 p-4 print:border-solid">
          {qrUrl ? (
            <>
              <img src={qrUrl} alt="QR label" className="h-32 w-32" data-testid="qr-image" />
              <p className="mt-2 max-w-[180px] truncate text-center text-xs font-medium">{name || "NexusMSP label"}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => window.print()}>
                <Printer className="mr-1 h-3 w-3" />Print
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Your label preview appears here</p>
          )}
        </div>
      </div>
    </Section>
  );
}

// ============== TECH CARD ==============

function ProtocolRegistry() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/protocol/coverage`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not read the protocol registry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Waypoints} title="Nexus Protocol" hint="The standard objects and actions third-party technology speaks to become Nexus-compatible — and the platform's honest coverage of its own protocol.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="protocol-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Waypoints className="mr-1 h-3 w-3" />}Read the protocol
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="protocol-result">
          <p className="text-xs text-muted-foreground">{result.actions_shipped} of 10 standard actions shipped · {result.actions_partial} partial (wired, not yet full verified execution)</p>
          <ul className="mt-2 space-y-1 text-xs">
            {result.coverage.map((row) => (
              <li key={row.action} className="flex items-center justify-between gap-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                <span className="font-mono">{row.action}()</span>
                <span className={row.status === "shipped" ? "text-emerald-300" : "text-amber-300"}>{row.status} · {row.platform_home}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function NexusNativeCertification() {
  const { token } = useAuth();
  const [board, setBoard] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/protocol/conformance`, { headers: { Authorization: `Bearer ${token}` } });
      setBoard(data);
    } catch {
      toast.error("Could not build the conformance board.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={BadgeCheck} title="Nexus Native certification" hint="What a vendor must prove: provisioning, telemetry, billing, health, remediation, uninstall, audit, evidence. Gaps are published — never hidden.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="native-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BadgeCheck className="mr-1 h-3 w-3" />}Evaluate adapters
      </Button>
      {board && (
        <div className="mt-3 space-y-1 text-xs" data-testid="native-result">
          {board.adapters.map((a) => (
            <div key={a.adapter} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{a.vendor || a.adapter}</span>
                <span className={a.level === "nexus_native" ? "text-emerald-300" : a.level === "nexus_ready" ? "text-cyan-300" : "text-amber-300"}>
                  {a.level === "nexus_native" ? "Nexus Native ✓" : a.level}
                </span>
              </div>
              <p className="text-muted-foreground">verified {a.counts.verified} · partial {a.counts.partial} · unverified {a.counts.unverified}</p>
              {a.latest_review && <p className="text-violet-200/80">review: {a.latest_review.decision} ({a.latest_review.basis})</p>}
            </div>
          ))}
          {board.adapters[0]?.honesty_note && <p className="pt-1 text-[10px] italic text-muted-foreground">{board.adapters[0].honesty_note}</p>}
        </div>
      )}
    </Section>
  );
}

function TechCardPanel() {
  const { token, user } = useAuth();
  const [svg, setSvg] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/team/${user.id}/profile`, { headers: { Authorization: `Bearer ${token}` } });
      const built = buildTechCardSvg(data);
      setSvg(built);
      playSound("fanfare");
    } catch {
      toast.error("Could not build your tech card");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = techCardFilename({ name: user?.name });
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Section icon={IdCard} title="Tech trading card" hint="A shareable collectible built from your real Nexus stats — points, badges, companion and title.">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={generate} disabled={busy} data-testid="tech-card-generate">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <IdCard className="mr-1 h-3 w-3" />}Generate my card
        </Button>
        {svg && (
          <Button size="sm" variant="outline" onClick={download} data-testid="tech-card-download">
            <Download className="mr-1 h-3 w-3" />Download SVG
          </Button>
        )}
      </div>
      {svg && (
        <div className="mt-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} data-testid="tech-card-preview" />
      )}
    </Section>
  );
}

// ============== WIN WALL + WEATHER + SEASONS + SPEEDRUNS ==============

function WinWall() {
  const { token } = useAuth();
  const [wins, setWins] = useState([]);

  useEffect(() => {
    axios.get(`${API}/tech-fun/win-wall`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setWins(data.wins || []))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={Trophy} title="Win Wall" hint="Recent closed-ticket wins across your clients — criticals and fast saves up top.">
      {wins.length === 0 ? (
        <p className="text-xs text-muted-foreground">No wins yet. Go close something!</p>
      ) : (
        <ul className="space-y-2">
          {wins.map((win) => {
            const kind = WIN_KINDS[win.kind] || WIN_KINDS.close;
            return (
              <li key={win.id} className="flex items-center justify-between rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2 text-sm">
                <span className="truncate"><span className="mr-2">{kind.icon}</span>{win.title}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{win.assigned_name || "—"} · {win.client_name || ""}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function NetworkWeather() {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);

  useEffect(() => {
    axios.get(`${API}/tech-fun/network-weather`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setClients(data.clients || []))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={CloudSun} title="Network weather" hint="Per-client forecast derived from live device status and last-seen telemetry.">
      {clients.length === 0 ? (
        <p className="text-xs text-muted-foreground">No device telemetry in scope yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {clients.map((client) => {
            const weather = WEATHER[client.weather] || WEATHER.cloudy;
            return (
              <div key={client.client_name} className="flex items-center justify-between rounded-lg border border-sky-500/15 bg-sky-500/[0.04] px-3 py-2 text-sm">
                <span className="truncate">{client.client_name}</span>
                <span className={`flex items-center gap-1 text-xs ${weather.tone}`}>
                  <span>{weather.icon}</span>{weather.label} · {client.devices} devices
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function SeasonStandings() {
  const { token } = useAuth();
  const [season, setSeason] = useState(null);

  useEffect(() => {
    axios.get(`${API}/tech-fun/season`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setSeason(data))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={Trophy} title="MSP League" hint={`Season ${season?.season || "—"} — monthly points standings from the live ledger, plus the hall of fame.`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-widest text-violet-400">This month</p>
          {(season?.standings || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No points awarded yet this season.</p>
          ) : (
            <ol className="space-y-1">
              {season.standings.map((row, index) => (
                <li key={row.user_id} className="flex items-center justify-between rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-1.5 text-sm">
                  <span>{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {row.name}</span>
                  <span className="text-xs text-amber-300">{row.points.toLocaleString()} pts</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-widest text-violet-400">Hall of fame</p>
          {(season?.hall_of_fame || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No completed seasons yet.</p>
          ) : (
            <ul className="space-y-1">
              {season.hall_of_fame.map((entry) => (
                <li key={entry.month} className="flex items-center justify-between rounded-lg border border-violet-500/15 bg-violet-500/[0.04] px-3 py-1.5 text-sm">
                  <span>🏆 {entry.winner.name}</span>
                  <span className="text-xs text-muted-foreground">{entry.month}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

function Speedruns() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState("");
  const [board, setBoard] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/onboarding-checklists/templates`, { headers })
      .then(({ data }) => {
        const rows = data.templates || data || [];
        setTemplates(rows);
        if (rows.length > 0) setSelected(rows[0].id || rows[0].template_id || "");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selected) return;
    axios.get(`${API}/tech-fun/speedruns/${selected}`, { headers })
      .then(({ data }) => setBoard(data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const fmt = (seconds) => `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  return (
    <Section icon={Timer} title="Checklist speedruns" hint="Fastest completed onboarding-checklist runs — race your own personal best.">
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No checklist templates yet. Create one in Onboarding Checklists first.</p>
      ) : (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-lg border border-violet-400/25 bg-slate-900 px-3 py-2 text-sm"
            data-testid="speedrun-template"
          >
            {templates.map((template) => (
              <option key={template.id || template.template_id} value={template.id || template.template_id}>
                {template.name || template.title || "Checklist"}
              </option>
            ))}
          </select>
          {board && (
            <div className="mt-3 space-y-1">
              {board.leaderboard?.length ? board.leaderboard.map((row, index) => (
                <div key={row.run_id} className="flex items-center justify-between rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-1.5 text-sm">
                  <span>{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {row.technician_name}</span>
                  <span className="text-xs text-emerald-300">{fmt(row.seconds)}</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">No completed runs to time yet.</p>}
              {board.personal_best && (
                <p className="pt-2 text-xs text-muted-foreground">
                  Your personal best: <span className="text-violet-300">{fmt(board.personal_best.seconds)}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ============== NOTE TRANSLATOR ==============

function NoteTranslator() {
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (mode) => {
    if (!text.trim()) {
      toast.error("Paste a note first");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/translator`, { mode, text }, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data.result);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not translate the note");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Languages} title="Note translator" hint="Rule-based and on-server: venting becomes professional, jargon becomes customer language. Always an editable draft.">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Fucking Microsoft broke Outlook again… or: Rebuilt TCP/IP stack, flushed DNS cache…"
        className="h-20 w-full rounded-lg border border-violet-400/25 bg-slate-900 p-2 text-sm"
        data-testid="translator-input"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => run("professionalise")} disabled={busy} data-testid="translator-professionalise">✨ Professionalise</Button>
        <Button size="sm" variant="outline" onClick={() => run("customer")} disabled={busy} data-testid="translator-customer">Customer update</Button>
      </div>
      {result && (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-sm" data-testid="translator-result">{result}</div>
      )}
    </Section>
  );
}

// ============== IS IT DNS / REALITY CHECK ==============

function IsItDns() {
  const { token } = useAuth();
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/is-it-dns`, { headers: { Authorization: `Bearer ${token}` } });
      setVerdict(data);
    } catch {
      toast.error("DNS check failed to run");
    } finally {
      setBusy(false);
    }
  };

  const tone = verdict?.answer === "YES" ? "border-red-500/30 bg-red-500/[0.06]" : verdict?.answer === "NO" ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-amber-500/30 bg-amber-500/[0.06]";

  return (
    <Section icon={Network} title="Is It DNS?" hint="Run the full diagnostic chain against real hostnames in scope and get a straight answer.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="is-it-dns-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Network className="mr-1 h-3 w-3" />}Run the complete DNS chain
      </Button>
      {verdict && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${tone}`} data-testid="is-it-dns-verdict">
          <p className="font-semibold">{verdict.headline}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {verdict.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          {verdict.tested_hosts?.length > 0 && (
            <p className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">Tested: {verdict.tested_hosts.join(", ")}</p>
          )}
        </div>
      )}
    </Section>
  );
}

function RealityCheck() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!deviceId.trim()) {
      toast.error("Enter the device ID the claim is about");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/verify-report`, { params: { device_id: deviceId.trim() }, headers: { Authorization: `Bearer ${token}` } });
      setReport(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not verify the report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={ShieldCheck} title="Verify User Report" hint="Evidence summary for a customer claim — facts, never accusations. Officially not called the bullshit detector.">
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID (e.g. dev-1)" data-testid="verify-device" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="verify-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}Verify
        </Button>
      </div>
      {report && report.found && (
        <div className="mt-3 space-y-1" data-testid="verify-report">
          {report.evidence.map((row) => (
            <p key={row.source} className="text-xs text-muted-foreground"><span className="text-violet-300">{row.source}:</span> {row.detail}</p>
          ))}
          <p className="pt-1 text-sm font-medium">{report.verdict}</p>
        </div>
      )}
      {report && !report.found && <p className="mt-2 text-xs text-muted-foreground">Device not found in your scope.</p>}
    </Section>
  );
}

// ============== BOSS BATTLES / PERSONALITY / CELEBRATIONS ==============

function BossBattles() {
  const { token } = useAuth();
  const [battles, setBattles] = useState([]);

  useEffect(() => {
    axios.get(`${API}/tech-fun/boss-battles`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setBattles(data.battles || []))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={Swords} title="Boss Battles" hint="Tickets open absurdly long. Slay them and the queue remembers.">
      {battles.length === 0 ? (
        <p className="text-xs text-muted-foreground">No bosses alive. Your queue is terrifyingly healthy.</p>
      ) : (
        <ul className="space-y-2">
          {battles.map((battle) => (
            <li key={battle.id} className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3 text-sm" data-testid="boss-battle">
              <div className="flex items-center justify-between">
                <span className="font-semibold">⚔️ {battle.title}</span>
                <Badge variant="outline" className="text-red-300 border-red-400/40">{battle.battle_rank}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Open: {battle.open_days} days · Notes: {battle.notes} · Assigned: {battle.assigned_name || "unclaimed"} · {battle.client_name || ""}
              </p>
              <p className="mt-1 text-xs italic text-red-200/80">Finish it.</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DevicePersonality() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [story, setStory] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!deviceId.trim()) {
      toast.error("Enter the device ID");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/device-personality/${encodeURIComponent(deviceId.trim())}`, { headers: { Authorization: `Bearer ${token}` } });
      setStory(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not read the device story");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Server} title="Device personality" hint="A generated history for long-lived machines — and a nudge when a veteran deserves retirement.">
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID (e.g. dev-1)" data-testid="personality-device" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="personality-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Server className="mr-1 h-3 w-3" />}Tell me
        </Button>
      </div>
      {story && story.found && (
        <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3 text-sm" data-testid="personality-story">
          <p className="font-semibold">{story.hostname} {story.unicorn ? "🦄" : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Age: {story.age_days != null ? `${Math.floor(story.age_days / 365)}y ${Math.floor((story.age_days % 365) / 30)}m` : "unknown"} ·
            Incidents survived: {story.incidents_survived} · Reboots: {story.reboots}
          </p>
          <p className="mt-2 text-xs italic text-violet-200/90">Nexus assessment: {story.assessment}</p>
          {story.replacement_note && <p className="mt-1 text-xs text-amber-300">{story.replacement_note}</p>}
        </div>
      )}
      {story && !story.found && <p className="mt-2 text-xs text-muted-foreground">Device not found in your scope.</p>}
    </Section>
  );
}

function Celebrations() {
  const { token } = useAuth();
  const [state, setState] = useState(null);

  useEffect(() => {
    axios.get(`${API}/tech-fun/celebrations`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setState(data))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={PartyPopper} title="Queue status" hint="Because closing the last ticket of the day should feel like something.">
      {state?.inbox_zero ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] p-4 text-center" data-testid="inbox-zero">
          <p className="text-2xl">🎉</p>
          <p className="mt-1 text-lg font-semibold text-emerald-300">INBOX ZERO</p>
          <p className="text-xs text-muted-foreground">{state.closed_count} closed. Nothing open. Nexus acknowledges your sacrifice.</p>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <p>Open assigned tickets: <span className="text-violet-300">{state?.open_count ?? "—"}</span></p>
          <p>Closed so far: <span className="text-emerald-300">{state?.closed_count ?? "—"}</span></p>
          <p className="text-xs text-muted-foreground">
            Next platform milestone: ticket #{state?.next_global_milestone?.toLocaleString() || "—"} ({state?.milestone_distance ?? "—"} to go).
          </p>
        </div>
      )}
    </Section>
  );
}

// ============== SHIFT INTELLIGENCE & MEMORY ==============

function GoHomeCheck() {
  const { token } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/can-i-go-home`, { headers: { Authorization: `Bearer ${token}` } });
      setState(data);
    } catch {
      toast.error("Could not run the end-of-day checklist.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Home} title="Can I go home?" hint="The end-of-day checklist, answered from live tickets, servers, backups, remote sessions and alerts.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="go-home-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Home className="mr-1 h-3 w-3" />}🏠 Can I Go Home?
      </Button>
      {state && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${state.go_home ? "border-emerald-500/30 bg-emerald-500/[0.08]" : "border-amber-500/30 bg-amber-500/[0.08]"}`} data-testid="go-home-verdict">
          <p className="font-semibold">{state.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {state.checks.map((check) => (
              <li key={check.label} className={check.ok ? "text-emerald-300" : "text-amber-300"}>
                {check.ok ? "✓" : "✗"} {check.label} — {check.detail}
              </li>
            ))}
          </ul>
          {state.go_home && <p className="mt-2 text-xs text-muted-foreground">Nexus is watching things.</p>}
        </div>
      )}
    </Section>
  );
}

function WeekendRisk() {
  const { token } = useAuth();
  const [state, setState] = useState(null);

  useEffect(() => {
    axios.get(`${API}/tech-fun/weekend-risk`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setState(data))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={Beer} title="Weekend risk" hint="What could ruin your weekend — disk headroom, expiring warranties, offline devices and stale backups.">
      {!state ? (
        <p className="text-sm text-muted-foreground">Scanning the estate…</p>
      ) : (
        <div data-testid="weekend-risk">
          <p className="text-sm">{state.verdict}</p>
          {state.items.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {state.items.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                  <span className={item.severity === "high" ? "text-red-300" : item.severity === "medium" ? "text-amber-300" : "text-slate-300"}>
                    {item.severity === "high" ? "🔴" : item.severity === "medium" ? "🟡" : "⚪"} {item.title}
                  </span>
                  <p className="mt-0.5 text-muted-foreground">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function CaughtUp() {
  const { token } = useAuth();
  const [hours, setHours] = useState("24");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/caught-up`, {
        params: { hours: Math.max(1, Math.min(336, Number(hours) || 24)) },
        headers: { Authorization: `Bearer ${token}` },
      });
      setState(data);
    } catch {
      toast.error("Could not build the digest.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ListChecks} title="What did I miss?" hint="The return-from-absence digest: everything that happened, and the handful of things that actually matter.">
      <div className="flex gap-2">
        <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="hours away (e.g. 24)" data-testid="caught-up-hours" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="caught-up-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ListChecks className="mr-1 h-3 w-3" />}Catch me up
        </Button>
      </div>
      {state && (
        <div className="mt-3 space-y-2 text-sm" data-testid="caught-up-digest">
          <p className="text-xs text-muted-foreground">
            In the last {state.window_hours}h: {state.alerts_total} alerts occurred · {state.alerts_resolved} resolved themselves · {state.tickets_updated} of your tickets updated.
          </p>
          {state.need_to_know.length > 0 && (
            <ul className="space-y-1 text-xs">
              {state.need_to_know.map((ticket) => (
                <li key={ticket.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <Badge className="mr-1.5" variant={ticket.priority === "critical" ? "destructive" : "secondary"}>{ticket.priority}</Badge>
                  {ticket.title} {ticket.client_name ? <span className="text-muted-foreground">· {ticket.client_name}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs italic text-violet-200/90">{state.verdict}</p>
        </div>
      )}
    </Section>
  );
}

function MemoryPin() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ object_type: "device", object_id: "", text: "" });
  const [memories, setMemories] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!form.object_id.trim()) return;
    try {
      const { data } = await axios.get(`${API}/tech-fun/memory`, {
        params: { object_type: form.object_type, object_id: form.object_id }, headers,
      });
      setMemories(data.memories || []);
    } catch {
      /* leave the list as-is */
    }
  };

  const pin = async () => {
    if (!form.object_id.trim() || !form.text.trim()) {
      toast.error("An object and a note are both required.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/memory`, form, { headers });
      toast.success("📌 Nexus will remember that.");
      setForm((prev) => ({ ...prev, text: "" }));
      await load();
    } catch {
      toast.error("Could not pin that memory.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Brain} title="Nexus must remember this" hint="Operational knowledge attached to an object — customer quirks, change hazards, tribal knowledge that survives staff turnover.">
      <div className="space-y-2">
        <div className="flex gap-2">
          <select className="h-9 rounded-md border border-input bg-transparent px-2 text-xs" value={form.object_type}
            onChange={(e) => setForm((prev) => ({ ...prev, object_type: e.target.value }))} data-testid="memory-type">
            <option value="device">Device</option>
            <option value="client">Customer</option>
            <option value="site">Site</option>
            <option value="user">User</option>
            <option value="general">General</option>
          </select>
          <Input value={form.object_id} onChange={(e) => setForm((prev) => ({ ...prev, object_id: e.target.value }))}
            placeholder="object ID" data-testid="memory-object" />
          <Button size="sm" variant="outline" onClick={load} data-testid="memory-load">Recall</Button>
        </div>
        <Input value={form.text} onChange={(e) => setForm((prev) => ({ ...prev, text: e.target.value }))}
          placeholder="e.g. Don't restart APP01 between 2–4 PM — payroll runs." data-testid="memory-text" />
        <Button size="sm" onClick={pin} disabled={busy} data-testid="memory-pin">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Brain className="mr-1 h-3 w-3" />}📌 Pin memory
        </Button>
        {memories.length > 0 && (
          <ul className="space-y-1 text-xs" data-testid="memory-list">
            {memories.map((memory) => (
              <li key={memory.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                {memory.text}
                <p className="mt-0.5 text-[10px] text-muted-foreground">pinned by {memory.pinned_by_name || "a technician"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function ChangeRisk() {
  const { token } = useAuth();
  const [form, setForm] = useState({ device_id: "", description: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/change-risk`, form, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not score that change.");
    } finally {
      setBusy(false);
    }
  };
  const tone = result?.band === "Low" ? "text-emerald-300" : result?.band === "Moderate" ? "text-amber-300" : "text-red-300";
  return (
    <Section icon={Gauge} title="Change risk score" hint="Enterprise change management without the ITIL bureaucracy — an explainable risk score before you touch anything.">
      <div className="flex gap-2">
        <Input value={form.device_id} onChange={(e) => setForm((prev) => ({ ...prev, device_id: e.target.value }))}
          placeholder="device ID" data-testid="risk-device" />
        <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="planned change (e.g. firmware upgrade)" data-testid="risk-description" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="risk-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Gauge className="mr-1 h-3 w-3" />}Score it
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="risk-result">
          <p className="text-base font-semibold">
            Risk: <span className={tone}>{result.score}/100 — {result.band}</span>
          </p>
          {result.reasons.length > 0 && (
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{result.recommendation}</p>
        </div>
      )}
    </Section>
  );
}

function NopeButton() {
  const { token } = useAuth();
  const [verdict, setVerdict] = useState("wrong_root_cause");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/feedback`, { verdict, note, source_type: "tool", source_id: "toolbox" },
        { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Logged. Nexus learns from the outcome.");
      setNote("");
    } catch {
      toast.error("Could not record that feedback.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ThumbsDown} title="Nope. Wrong diagnosis." hint="Correct Nexus when it gets something wrong — wrong root cause, wrong remediation, missing information or an unsafe recommendation.">
      <div className="flex gap-2">
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-xs" value={verdict}
          onChange={(e) => setVerdict(e.target.value)} data-testid="nope-verdict">
          <option value="wrong_root_cause">Wrong root cause</option>
          <option value="wrong_remediation">Wrong remediation</option>
          <option value="missing_information">Missing information</option>
          <option value="unsafe_recommendation">Unsafe recommendation</option>
          <option value="other">Other</option>
        </select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what actually happened (optional)" data-testid="nope-note" />
        <Button size="sm" variant="outline" onClick={send} disabled={busy} data-testid="nope-send">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ThumbsDown className="mr-1 h-3 w-3" />}👎 Nope
        </Button>
      </div>
    </Section>
  );
}

const LABS_ITEMS = [
  ["predictive_ticketing", "Predictive ticketing"],
  ["autonomous_diagnosis", "Autonomous diagnosis"],
  ["natural_language_control", "Natural language control"],
  ["failure_prediction", "Failure prediction"],
  ["experimental_remediation", "Experimental remediation"],
];

function LabsFlags() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    axios.get(`${API}/tech-fun/labs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setFlags(data.flags || {}))
      .catch(() => {});
  }, [token]);

  const toggle = async (key) => {
    const next = { ...flags, [key]: !flags?.[key] };
    setFlags(next);
    try {
      await axios.put(`${API}/tech-fun/labs`, { flags: next }, { headers });
    } catch (error) {
      setFlags(flags);
      toast.error(error?.response?.data?.detail || "Only admins can toggle Labs features.");
    }
  };

  return (
    <Section icon={FlaskConical} title="🧪 Nexus Labs" hint="Experimental capabilities, opt-in per tenant — enable internally first, then friendly customers, then production.">
      <div className="flex flex-wrap gap-2">
        {LABS_ITEMS.map(([key, label]) => (
          <Button key={key} size="sm" variant={flags?.[key] ? "default" : "outline"} onClick={() => toggle(key)} data-testid={`labs-${key}`}>
            {label}{flags?.[key] ? " · on" : ""}
          </Button>
        ))}
      </div>
    </Section>
  );
}

// ============== CONTEXT-AWARENESS ==============

const TRIAGE_TONE = { Ignore: "text-emerald-300", Investigate: "text-red-300", Watch: "text-amber-300" };

function AlertTriage() {
  const { token } = useAuth();
  const [alertId, setAlertId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/alert-triage/${encodeURIComponent(alertId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not triage that alert.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Siren} title="Should I care?" hint="Why am I looking at this? Every alert gets a verdict with evidence — Ignore, Investigate or Watch.">
      <div className="flex gap-2">
        <Input value={alertId} onChange={(e) => setAlertId(e.target.value)} placeholder="alert ID" data-testid="triage-alert" />
        <Button size="sm" onClick={run} disabled={busy || !alertId.trim()} data-testid="triage-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Siren className="mr-1 h-3 w-3" />}Triage
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="triage-result">
          <p className="text-base font-semibold">
            {result.alert?.message || result.alert?.alert_type} — <span className={TRIAGE_TONE[result.verdict]}>{result.verdict}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{result.why_now}</p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-violet-200/90">
            {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
    </Section>
  );
}

function BlastRadius() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/blast-radius/${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not map that device.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Radar} title="Blast radius" hint="Click any device: if this fails, what is affected? Derived from live relationships only.">
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID" data-testid="blast-device" />
        <Button size="sm" onClick={run} disabled={busy || !deviceId.trim()} data-testid="blast-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Radar className="mr-1 h-3 w-3" />}Map it
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="blast-result">
          <p className="font-semibold">{result.headline}</p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {result.impacts.map((impact) => <li key={impact}>{impact}</li>)}
          </ul>
        </div>
      )}
    </Section>
  );
}

function WorkLocks() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/work-lock/${encodeURIComponent(deviceId)}`, { headers });
      setStatus(data);
    } catch {
      toast.error("Could not check that device.");
    } finally {
      setBusy(false);
    }
  };
  const claim = async (force = false) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/work-lock`, { device_id: deviceId, force }, { headers });
      if (data.acquired) {
        toast.success(data.taken_from ? `Ownership taken from ${data.taken_from}.` : "You're on it — others will see you're working here.");
      } else {
        toast.warning(`${data.held_by} is currently working on this device.`);
      }
      await check();
    } catch {
      toast.error("Could not claim that device.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Lock} title="Before you touch it…" hint="Soft object locks: see who else is on the device, what's already open, then claim or deliberately take ownership.">
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID" data-testid="lock-device" />
        <Button size="sm" variant="outline" onClick={check} disabled={busy || !deviceId.trim()} data-testid="lock-check">Check</Button>
        <Button size="sm" onClick={() => claim(false)} disabled={busy || !deviceId.trim()} data-testid="lock-claim">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Lock className="mr-1 h-3 w-3" />}Work on this
        </Button>
      </div>
      {status && (
        <div className="mt-3 text-sm" data-testid="lock-status">
          <p className={status.safe_to_proceed ? "text-emerald-300" : "text-amber-300"}>
            {status.safe_to_proceed ? "✓ Nobody else is on this device." : "⚠ Check before you touch it:"}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {status.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
          {status.held_by && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => claim(true)} data-testid="lock-takeover">
              Take Ownership
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function HandoverDigest() {
  const { token } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/handover`, { headers: { Authorization: `Bearer ${token}` } });
      setState(data);
    } catch {
      toast.error("Could not build the handover.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ArrowRightLeft} title="Shift handover" hint="The 5 PM digest: active issues, customers waiting, vendor escalations, running work — and who should take what.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="handover-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3 w-3" />}Build my handover
      </Button>
      {state && (
        <div className="mt-3 space-y-1.5 text-sm" data-testid="handover-result">
          <p className="text-xs text-muted-foreground">
            {state.active_issues.length} active issue(s) · {state.customer_waiting.length} customer(s) waiting ·
            {" "}{state.vendor_escalations.length} vendor escalation(s) · {state.running.length} running · {state.follow_ups.length} follow-up(s)
          </p>
          {state.active_issues.slice(0, 5).map((ticket) => (
            <p key={ticket.id} className="text-xs">
              <Badge className="mr-1.5" variant={ticket.priority === "critical" ? "destructive" : "secondary"}>{ticket.priority}</Badge>
              {ticket.ticket_number || ticket.id} — {ticket.title} {ticket.client_name ? <span className="text-muted-foreground">· {ticket.client_name}</span> : null}
            </p>
          ))}
          {state.recommendation && <p className="text-xs italic text-violet-200/90">{state.recommendation}</p>}
        </div>
      )}
    </Section>
  );
}

function CustomerCost() {
  const { token } = useAuth();
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/customer-cost/${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not analyse that customer.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={PiggyBank} title="Why is this customer expensive?" hint="Support demand versus comparable customers, cost drivers, and an honest avoidable-cost estimate.">
      <div className="flex gap-2">
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="customer ID or name" data-testid="cost-client" />
        <Button size="sm" onClick={run} disabled={busy || !clientId.trim()} data-testid="cost-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PiggyBank className="mr-1 h-3 w-3" />}Analyse
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="cost-result">
          <p className="font-semibold">{result.verdict}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.total_tickets} tickets vs peer median {result.peer_median_tickets} · {result.support_hours}h recorded ·
            {" "}est. delivery cost ${result.estimated_delivery_cost?.toLocaleString()} · avoidable ${result.estimated_avoidable_cost?.toLocaleString()}
          </p>
          {result.drivers?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.drivers.map((driver) => (
                <li key={driver.category} className="flex items-center gap-2">
                  <span className="w-36 truncate">{driver.category}</span>
                  <span className="h-1.5 rounded bg-violet-500/40" style={{ width: `${Math.max(6, driver.share_pct)}%` }} />
                  <span className="text-muted-foreground">{driver.share_pct}%</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{result.recommendation}</p>
        </div>
      )}
    </Section>
  );
}

// ============== INSIGHT LAYER ==============

function BehaviourBaseline() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/baseline/${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not baseline that device.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Activity} title="Understand normal" hint="What is normal for THIS device? Peer-derived behaviour bands — so 85% RAM is only interesting when 85% isn't this server's normal.">
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID" data-testid="baseline-device" />
        <Button size="sm" onClick={run} disabled={busy || !deviceId.trim()} data-testid="baseline-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Activity className="mr-1 h-3 w-3" />}Baseline
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="baseline-result">
          <p className="font-semibold">{result.verdict}</p>
          <div className="mt-2 space-y-1.5">
            {Object.entries(result.bands || {}).map(([stat, band]) => (
              <div key={stat} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                <span className={band.unusual ? "text-amber-300" : "text-slate-300"}>
                  {stat.replace(/_/g, " ")}: {band.current}%
                  {band.normal_band ? ` — normal ${band.normal_band[0]}–${band.normal_band[1]}%` : ""}
                  {band.unusual ? " ⚠ unusual" : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.baseline_note}</p>
        </div>
      )}
    </Section>
  );
}

const ANOMALY_KINDS = {
  odd_hours: "🌙", auth_burst: "🔐", backup_drift: "💾", new_device: "🆕", stat_outlier: "📈",
};

function SomethingFeelsWrong() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/anomaly-scan`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not run the anomaly scan.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Eye} title="👀 Something feels wrong" hint="No obvious alert yet? Broad anomaly analysis across the estate — statistically unusual, not necessarily broken. Professionally: the Anomaly Explorer.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="anomaly-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Eye className="mr-1 h-3 w-3" />}Something Feels Wrong
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="anomaly-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.findings.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {result.findings.map((finding, index) => (
                <li key={`${finding.kind}-${index}`} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                  <span className="text-violet-200">{ANOMALY_KINDS[finding.kind] || "❓"} {finding.title}</span>
                  <p className="mt-0.5 text-muted-foreground">{finding.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {result.clusters.map((cluster, index) => (
            <p key={index} className="mt-2 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-xs text-amber-200">
              {cluster.findings.length} behaviours began together — probable common dependency: {cluster.probable_common_dependency}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

function UniversalTimeline() {
  const { token } = useAuth();
  const [filters, setFilters] = useState({ person: "", device: "", customer: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/timeline`, {
        params: { hours: 24, user_filter: filters.person, device_filter: filters.device, client_filter: filters.customer },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch {
      toast.error("Could not build the timeline.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={History} title="Nexus Timeline" hint="One universal timeline: logins, alerts, tickets, sessions, automation and billing — then filter by person, device or customer.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-28" value={filters.person} onChange={(e) => setFilters({ ...filters, person: e.target.value })} placeholder="person" data-testid="timeline-person" />
        <Input className="h-8 w-28" value={filters.device} onChange={(e) => setFilters({ ...filters, device: e.target.value })} placeholder="device" data-testid="timeline-device" />
        <Input className="h-8 w-28" value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} placeholder="customer" data-testid="timeline-customer" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="timeline-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <History className="mr-1 h-3 w-3" />}Build
        </Button>
      </div>
      {result && (
        <div className="mt-3" data-testid="timeline-result">
          <p className="text-xs text-muted-foreground">{result.count} event(s) in the last {result.scanned_hours}h</p>
          <ul className="mt-2 space-y-1">
            {result.events.map((event, index) => (
              <li key={`${event.kind}-${index}`} className="flex items-start gap-2 text-xs">
                <span className="w-11 shrink-0 font-mono text-muted-foreground">
                  {new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="w-16 shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wide text-violet-200">{event.kind}</span>
                <span className="flex-1">{event.title}{event.user_name ? ` — ${event.user_name}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function UniversalSearch() {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/universal-search`, {
        params: { q: query },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch {
      toast.error("Search failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Search} title="One search box for everything" hint="Phone number, serial, IP, email, invoice number — one query finds every object that mentions it, across the whole MSP.">
      <div className="flex gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.trim() && run()}
          placeholder="0412 345 678 · SN-4455 · INC-0001" data-testid="search-query" />
        <Button size="sm" onClick={run} disabled={busy || !query.trim()} data-testid="search-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Search className="mr-1 h-3 w-3" />}Search
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="search-result">
          <p className="text-xs text-muted-foreground">{result.total} match(es) for "{result.query}"</p>
          {Object.entries(result.groups).map(([kind, rows]) => (
            <div key={kind} className="mt-2">
              <p className="text-[10px] uppercase tracking-widest text-violet-400">{kind}</p>
              <ul className="mt-1 space-y-1">
                {rows.map((row, index) => (
                  <li key={index} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                    {Object.values(row).filter(Boolean).join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SessionSidecar() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/session-sidecar/${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not build the sidecar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={PanelRight} title="Remote session sidecar" hint="Everything beside the session: device health, open tickets, recent changes, warranty — without leaving the screen.">
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID" data-testid="sidecar-device" />
        <Button size="sm" onClick={run} disabled={busy || !deviceId.trim()} data-testid="sidecar-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PanelRight className="mr-1 h-3 w-3" />}Open sidecar
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="sidecar-result">
          <p className="font-semibold">
            {result.device?.hostname || result.device?.name} — health {result.device_health}/100
            {result.warranty_days_remaining != null && ` · warranty ${result.warranty_days_remaining >= 0 ? `${result.warranty_days_remaining} days left` : "expired"}`}
          </p>
          {result.health_penalties.length > 0 && (
            <p className="mt-1 text-xs text-amber-300">{result.health_penalties.join(" · ")}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{result.recent_changes} recent change(s) on record</p>
          {result.open_tickets.length > 0 && (
            <ul className="mt-1 space-y-1 text-xs">
              {result.open_tickets.map((ticket) => (
                <li key={ticket.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  {ticket.ticket_number || ticket.id}: {ticket.title} <span className="text-muted-foreground">({ticket.priority})</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {result.actions.map((action) => (
              <span key={action} className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">{action}</span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function WhileYoureThere() {
  const { token } = useAuth();
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/while-youre-there/${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not list on-site work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={MapPin} title="Since you're here…" hint="If you're already paying for the truck roll, everything worth physically doing at this customer while you're on site.">
      <div className="flex gap-2">
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="customer ID or name" data-testid="wyd-client" />
        <Button size="sm" onClick={run} disabled={busy || !clientId.trim()} data-testid="wyd-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MapPin className="mr-1 h-3 w-3" />}What's worth doing
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="wyd-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.tasks.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.tasks.map((task, index) => (
                <li key={index} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">{task.task}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function DependencyHorizon() {
  const { token } = useAuth();
  const [days, setDays] = useState("90");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/dependency-horizon`, {
        params: { days: Math.max(7, Math.min(365, Number(days) || 90)) },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch {
      toast.error("Could not scan the horizon.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={CalendarClock} title="Dependency calendar" hint="Warranties, patching debt, contract ends and renewals — what becomes somebody else's emergency if we ignore it?">
      <div className="flex gap-2">
        <Input className="h-8 w-20" value={days} onChange={(e) => setDays(e.target.value)} data-testid="horizon-days" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="horizon-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CalendarClock className="mr-1 h-3 w-3" />}Scan horizon
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="horizon-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.items.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.items.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className="text-violet-200">{item.date} · {item.title}</span>
                  <p className="mt-0.5 text-muted-foreground">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function AgreementMargin() {
  const { token } = useAuth();
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/agreement-margin/${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not price that agreement.");
    } finally {
      setBusy(false);
    }
  };
  const alerting = result?.verdict?.startsWith("⚠");
  return (
    <Section icon={TrendingDown} title="You're giving this customer away" hint="Agreement value versus estimated delivery cost from recorded ticket time — margin alerts before the renewal conversation.">
      <div className="flex gap-2">
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="customer ID or name" data-testid="margin-client" />
        <Button size="sm" onClick={run} disabled={busy || !clientId.trim()} data-testid="margin-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <TrendingDown className="mr-1 h-3 w-3" />}Check margin
        </Button>
      </div>
      {result && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${alerting ? "border-red-500/30 bg-red-500/[0.08]" : "border-emerald-500/30 bg-emerald-500/[0.08]"}`} data-testid="margin-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.monthly_value != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              ${result.monthly_value?.toLocaleString()}/month vs ${result.estimated_monthly_delivery_cost?.toLocaleString()} estimated delivery
              {result.recommended_monthly_range && ` · healthy range $${result.recommended_monthly_range[0].toLocaleString()}–$${result.recommended_monthly_range[1].toLocaleString()}`}
            </p>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{result.trend_note}</p>
        </div>
      )}
    </Section>
  );
}

function TechnicalDebt() {
  const { token } = useAuth();
  const [form, setForm] = useState({ title: "", why: "", proper_fix: "", review_due: "" });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/technical-debt`, { headers });
      setReport(data);
    } catch {
      toast.error("Could not load the debt report.");
    } finally {
      setBusy(false);
    }
  };
  const record = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/technical-debt`, form, { headers });
      toast.success("Temporary fix recorded. Future you has been warned.");
      setForm({ title: "", why: "", proper_fix: "", review_due: "" });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the debt.");
      setBusy(false);
    }
  };
  return (
    <Section icon={Hammer} title="Future Me Will Hate Me" hint="Record the temporary workaround with its why, review date and proper fix — Nexus resurfaces it before it turns seven years old.">
      <div className="space-y-2">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="temporary fix (required)" data-testid="debt-title" />
        <Input value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="why?" data-testid="debt-why" />
        <Input value={form.proper_fix} onChange={(e) => setForm({ ...form, proper_fix: e.target.value })} placeholder="what is the proper fix?" data-testid="debt-proper" />
        <div className="flex gap-2">
          <Input value={form.review_due} onChange={(e) => setForm({ ...form, review_due: e.target.value })} placeholder="review by (YYYY-MM-DD)" data-testid="debt-review" />
          <Button size="sm" onClick={record} disabled={busy || !form.title.trim()} data-testid="debt-record">
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Hammer className="mr-1 h-3 w-3" />}Record
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="debt-report-run">Show debt</Button>
        </div>
      </div>
      {report && (
        <div className="mt-3 text-sm" data-testid="debt-report">
          <p className="font-semibold">{report.open_items} open debt item(s) · ${report.recorded_estimated_remediation_cost?.toLocaleString()} recorded remediation estimate</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Estate: {report.estate?.devices} devices · {report.estate?.legacy_os} legacy OS · {report.estate?.out_of_warranty} out of warranty · {report.overdue_reviews?.length} overdue review(s)
          </p>
          {report.items?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {report.items.map((item) => (
                <li key={item.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className="text-violet-200">{item.title}</span>
                  {item.review_due && <span className="text-muted-foreground"> · review {item.review_due}</span>}
                  {item.why && <p className="mt-0.5 text-muted-foreground">Why: {item.why}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{report.cost_note}</p>
        </div>
      )}
    </Section>
  );
}

function KnowledgeCoverage() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/knowledge-coverage`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not measure knowledge coverage.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={HelpCircle} title="What don't we know?" hint="Unknown infrastructure is itself a risk. Nexus measures its own ignorance — then hands you a mission: Reduce Unknowns → 100%.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="coverage-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <HelpCircle className="mr-1 h-3 w-3" />}Measure the unknowns
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="coverage-result">
          <p className="font-semibold">{result.verdict}</p>
          <p className="mt-1 text-xs text-violet-200">{result.mission}</p>
          {result.unknowns.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.unknowns.map((u, i) => (
                <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className={u.severity === "high" ? "text-amber-300" : "text-slate-300"}>
                    ⚠ {u.count}× {u.unknown} ({u.domain})
                  </span>
                  <p className="mt-0.5 text-muted-foreground">{u.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {result.stale_facts.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-widest text-violet-400">Freshness — facts decay</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {result.stale_facts.slice(0, 4).map((f, i) => (
                  <li key={i}>{f.fact} — {f.days_old == null ? "never verified" : `verified ${f.days_old} days ago`}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function ProveIt() {
  const { token } = useAuth();
  const [claim, setClaim] = useState("backup");
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/prove-it`, {
        params: { claim, subject_id: subject },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not gather evidence.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={BadgeCheck} title="Prove It" hint="Next to every important claim. Not 'agent says enabled' — Nexus gathers evidence: claim → evidence → verdict. Backup says yes, Nexus says no.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-36" value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="backup · warranty · patching" data-testid="prove-claim" />
        <Input className="h-8 w-32" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="device/client ID" data-testid="prove-subject" />
        <Button size="sm" onClick={run} disabled={busy || !subject.trim()} data-testid="prove-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BadgeCheck className="mr-1 h-3 w-3" />}Prove It
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="prove-result">
          <p className={`font-semibold ${result.verdict === "verified" ? "text-emerald-300" : result.verdict === "contradicted" ? "text-red-300" : "text-amber-300"}`}>
            {String(result.verdict || "").toUpperCase()} — {result.claim}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {(result.evidence || []).map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <span>{e.status === "ok" ? "✓" : e.status === "stale" ? "⏳" : "✗"}</span>
                <span><span className="text-violet-200">{e.item}</span> — {e.detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.nexus_position}</p>
        </div>
      )}
    </Section>
  );
}

function ConfidenceReport() {
  const { token } = useAuth();
  const [objectType, setObjectType] = useState("device");
  const [objectId, setObjectId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/confidence/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No confidence to report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Gauge} title="Confidence everywhere" hint="Not all information is equally trustworthy. Every attribute gets a confidence score — click it to see why Nexus believes it.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-24" value={objectType} onChange={(e) => setObjectType(e.target.value)} placeholder="device · ticket" data-testid="confidence-type" />
        <Input className="h-8 w-32" value={objectId} onChange={(e) => setObjectId(e.target.value)} placeholder="object ID" data-testid="confidence-id" />
        <Button size="sm" onClick={run} disabled={busy || !objectId.trim()} data-testid="confidence-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Gauge className="mr-1 h-3 w-3" />}Why?
        </Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5" data-testid="confidence-result">
          {result.attributes.map((a) => (
            <div key={a.attribute} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-36 truncate text-violet-200">{a.attribute}: {a.value}</span>
                <span className={`font-mono ${a.confidence >= 80 ? "text-emerald-300" : a.confidence >= 50 ? "text-amber-300" : "text-red-300"}`}>{a.confidence}%</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{a.reason}</p>
            </div>
          ))}
          <p className="text-xs italic text-violet-200/90">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function TicketIntelligence() {
  const { token } = useAuth();
  const [ticketId, setTicketId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const id = encodeURIComponent(ticketId);
      const [difficulty, gravity, preflight] = await Promise.all([
        axios.get(`${API}/tech-fun/ticket-difficulty/${id}`, { headers }),
        axios.get(`${API}/tech-fun/ticket-gravity/${id}`, { headers }),
        axios.get(`${API}/tech-fun/escalation-preflight/${id}`, { headers }),
      ]);
      setResult({ difficulty: difficulty.data, gravity: gravity.data, preflight: preflight.data });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not analyse that ticket.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Sparkles} title="Ticket intelligence" hint="Difficulty before assignment, gravity before it eats the week, and the pre-escalation checklist Nexus runs itself.">
      <div className="flex gap-2">
        <Input value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="ticket ID" data-testid="tix-id" />
        <Button size="sm" onClick={run} disabled={busy || !ticketId.trim()} data-testid="tix-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}Analyse
        </Button>
      </div>
      {result && (
        <div className="mt-3 space-y-2 text-sm" data-testid="tix-result">
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
            <p className="text-violet-200">{result.difficulty.verdict}</p>
            <p className="mt-0.5 text-muted-foreground">
              Skill: {result.difficulty.likely_skill} · {result.difficulty.similar_incidents} similar incidents ·
              escalation probability {result.difficulty.escalation_probability_pct}%
            </p>
          </div>
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
            <p className={result.gravity.gravity_score >= 60 ? "text-amber-300" : "text-violet-200"}>{result.gravity.verdict}</p>
          </div>
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
            <p className="text-violet-200">{result.preflight.verdict}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {result.preflight.checks.map((c) => (
                <li key={c.check}>{c.ok ? "✓" : "✗"} {c.check} — {c.detail}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}

function NoiseBudget() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/noise-budget`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not measure the noise.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={BellOff} title="Noise budget" hint="Every alert source measured by what technicians actually did about it. Systematically destroy alert fatigue.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="noise-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BellOff className="mr-1 h-3 w-3" />}Measure the noise
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="noise-result">
          <p className="font-semibold">{result.verdict}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.total_alerts} alerts · {result.actionable} actionable · {result.required_human_action} needed a human · {result.already_suppressed} already suppressed
          </p>
          {result.by_type.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.by_type.map((row) => (
                <li key={row.alert_type} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className={row.noise_rate_pct >= 80 ? "text-amber-300" : "text-violet-200"}>
                    {row.alert_type}: {row.noise_rate_pct}% noise ({row.actionable}/{row.total} acted on)
                  </span>
                  <p className="mt-0.5 text-muted-foreground">{row.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function TicketCorrelation() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/correlate-tickets`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not correlate tickets.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={GitMerge} title="One problem, many symptoms" hint="Seven unrelated tickets are often one incident. Nexus correlates them — and finds work batches worth doing once.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="correlate-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <GitMerge className="mr-1 h-3 w-3" />}Correlate open tickets
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="correlate-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.clusters.map((c, i) => (
            <div key={i} className="mt-2 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-xs">
              <p className="text-amber-200">{c.symptom_count} symptoms at {c.client_name} — probable common cause: {c.probable_common_cause}</p>
              <p className="mt-0.5 text-muted-foreground">{c.tickets.join(" · ")}</p>
            </div>
          ))}
          {result.batches.map((b, i) => (
            <div key={i} className="mt-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
              <p className="text-violet-200">Work batch: {b.ticket_count}× '{b.shared_token}' ({b.category})</p>
              <p className="mt-0.5 text-muted-foreground">{b.suggested_flow}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function AuditReadiness() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/audit-readiness`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not assemble the evidence.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ClipboardCheck} title="😱 Auditor Tomorrow" hint="The Audit Readiness Pack: every control, its evidence and its gaps — assembled before the auditor arrives, not during.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="audit-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ClipboardCheck className="mr-1 h-3 w-3" />}Assemble evidence
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="audit-result">
          <p className="font-semibold">{result.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {result.controls.map((c) => (
              <li key={c.control} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                <span className={c.status === "verified" ? "text-emerald-300" : c.status === "failed" ? "text-red-300" : "text-amber-300"}>
                  {c.status === "verified" ? "✓" : c.status === "failed" ? "✗" : "⚠"} {c.control} — {c.status}
                </span>
                <p className="mt-0.5 text-muted-foreground">{c.evidence}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs italic text-violet-200/90">Pack: {result.pack_manifest.join(" · ")}</p>
        </div>
      )}
    </Section>
  );
}

function NexusLaws() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [laws, setLaws] = useState(null);
  const [action, setAction] = useState({ action_type: "", target: "", destructive: false, verification_planned: true });
  const [verdict, setVerdict] = useState(null);
  const [custom, setCustom] = useState({ kind: "forbidden_action", text: "", pattern: "", target_pattern: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    axios.get(`${API}/tech-fun/laws`, { headers }).then(({ data }) => setLaws(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const evaluate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/laws/evaluate`, action, { headers });
      setVerdict(data);
    } catch {
      toast.error("Could not evaluate the action.");
    } finally {
      setBusy(false);
    }
  };
  const addLaw = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/laws`, custom, { headers });
      toast.success("Law recorded. It now sits above users, scripts and AI.");
      const { data } = await axios.get(`${API}/tech-fun/laws`, { headers });
      setLaws(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Only admins can record laws.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Scale} title="Nexus Laws" hint="Non-negotiable invariants above users, scripts, integrations, AI and automations. Autonomy bounded by deterministic rules.">
      {laws && (
        <ul className="space-y-1 text-xs">
          {laws.builtin.slice(0, 5).map((law) => (
            <li key={law.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-violet-200">⚖ {law.text}</li>
          ))}
          {laws.custom.map((law) => (
            <li key={law.id} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">⚖ {law.text} <span className="text-muted-foreground">(custom: {law.kind})</span></li>
          ))}
        </ul>
      )}
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-32" value={action.action_type} onChange={(e) => setAction({ ...action, action_type: e.target.value })} placeholder="action (e.g. reboot)" data-testid="law-action" />
          <Input className="h-8 w-32" value={action.target} onChange={(e) => setAction({ ...action, target: e.target.value })} placeholder="target" data-testid="law-target" />
          <Button size="sm" variant={action.destructive ? "default" : "outline"} onClick={() => setAction({ ...action, destructive: !action.destructive })} data-testid="law-destructive">
            {action.destructive ? "💥 destructive" : "not destructive"}
          </Button>
          <Button size="sm" onClick={evaluate} disabled={busy || !action.action_type.trim()} data-testid="law-evaluate">Evaluate</Button>
        </div>
        {verdict && (
          <p className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${verdict.overall === "blocked" ? "border-red-500/30 bg-red-500/[0.08] text-red-300" : verdict.overall === "allowed" ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300" : "border-amber-500/30 bg-amber-500/[0.08] text-amber-300"}`} data-testid="law-verdict">
            {verdict.verdict}{verdict.decisions.length > 0 && ` — ${verdict.decisions[0].law}`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-36" value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} placeholder="custom law text" data-testid="law-custom-text" />
          <Input className="h-8 w-24" value={custom.pattern} onChange={(e) => setCustom({ ...custom, pattern: e.target.value })} placeholder="action" data-testid="law-custom-pattern" />
          <Input className="h-8 w-24" value={custom.target_pattern} onChange={(e) => setCustom({ ...custom, target_pattern: e.target.value })} placeholder="target" data-testid="law-custom-target" />
          <Button size="sm" variant="outline" onClick={addLaw} disabled={busy || !custom.text.trim()} data-testid="law-custom-add">Add law (admin)</Button>
        </div>
      </div>
    </Section>
  );
}

function CredentialGuard() {
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/credential-scan`, { text }, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not scan the draft.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ShieldAlert} title="Credential leak guard" hint="Paste a ticket draft here first. If a credential is in it, Nexus removes it — and never echoes the secret back."
    >
      <textarea
        className="h-20 w-full rounded-md border border-violet-500/20 bg-slate-900/60 p-2 text-xs"
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="paste a ticket draft or note…" data-testid="cred-text"
      />
      <Button size="sm" className="mt-2" onClick={run} disabled={busy || !text.trim()} data-testid="cred-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldAlert className="mr-1 h-3 w-3" />}Scan draft
      </Button>
      {result && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${result.detected ? "border-red-500/30 bg-red-500/[0.08]" : "border-emerald-500/30 bg-emerald-500/[0.08]"}`} data-testid="cred-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.detected && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">{result.guidance}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900/60 p-2 text-xs text-muted-foreground">{result.redacted_text}</pre>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function RealityChecks() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [ticketId, setTicketId] = useState("");
  const [result, setResult] = useState(null);
  const [presence, setPresence] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/ticket-reality-check/${encodeURIComponent(ticketId)}`, { headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not reality-check that ticket.");
    } finally {
      setBusy(false);
    }
  };
  const runPresence = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/presence-effect`, { headers });
      setPresence(data);
    } catch {
      toast.error("Could not measure the presence effect.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={MessageSquare} title="Ticket reality checks" hint="Urgency punctuation, the definition of insanity, 'nobody changed anything', 'it never worked' — and the Technician Presence Effect, tracked as a statistic.">
      <div className="flex gap-2">
        <Input value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="ticket ID" data-testid="reality-id" />
        <Button size="sm" onClick={run} disabled={busy || !ticketId.trim()} data-testid="reality-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MessageSquare className="mr-1 h-3 w-3" />}Reality check
        </Button>
        <Button size="sm" variant="outline" onClick={runPresence} disabled={busy} data-testid="presence-run">Presence effect</Button>
      </div>
      {result && (
        <ul className="mt-3 space-y-1 text-xs" data-testid="reality-result">
          {result.findings.length === 0 && <li className="text-muted-foreground">{result.verdict}</li>}
          {result.findings.map((f, i) => (
            <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-violet-200">
              {f.line}
              {f.changes && <p className="mt-0.5 text-muted-foreground">{f.changes.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
      {presence && (
        <p className="mt-2 text-xs text-amber-200" data-testid="presence-result">{presence.verdict}</p>
      )}
    </Section>
  );
}

function IntentOS() {
  const { token } = useAuth();
  const [statement, setStatement] = useState("");
  const [suggested, setSuggested] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const suggest = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/intent-suggest`, { statement }, { headers });
      setSuggested(data.suggested_controls);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not compile that intent.");
    } finally {
      setBusy(false);
    }
  };
  const recordAndEvaluate = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/intents`, { statement }, { headers });
      const { data } = await axios.get(`${API}/tech-fun/intent-evaluation`, { headers });
      setReport(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record that intent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Waypoints} title="Intent OS" hint="Stop configuring technology — state the business outcome. Nexus compiles plain English into checkable controls and continuously measures drift. Unverifiable controls are never reported as met.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 min-w-56 flex-1" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Every employee handling financial data must be MFA'd and encrypted" data-testid="intent-statement" />
        <Button size="sm" variant="outline" onClick={suggest} disabled={busy || !statement.trim()} data-testid="intent-suggest">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Waypoints className="mr-1 h-3 w-3" />}Compile
        </Button>
        <Button size="sm" onClick={recordAndEvaluate} disabled={busy || !statement.trim()} data-testid="intent-record">
          Record &amp; evaluate
        </Button>
      </div>
      {suggested && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="intent-suggested">
          {suggested.length ? suggested.map((c) => (
            <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
          )) : <span className="text-xs text-muted-foreground">No known controls suggested — add explicit controls.</span>}
        </div>
      )}
      {report && (
        <div className="mt-3 space-y-1 text-xs" data-testid="intent-report">
          <p className="font-semibold text-sm">{report.drifting} drifting / {report.count} intent(s)</p>
          {report.intents.map((intent) => (
            <div key={intent.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="font-medium">{intent.statement}</p>
              {intent.results.map((r) => (
                <p key={r.control} className={r.verdict === "drifting" ? "text-amber-300" : r.verdict === "met" ? "text-emerald-300" : "text-muted-foreground"}>
                  {r.verdict === "met" ? "✓" : r.verdict === "drifting" ? "⚠" : "?"} {r.control}: {r.reason}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ITGenome() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const scan = async () => {
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [issues, insights, contribution] = await Promise.all([
        axios.get(`${API}/tech-fun/genome/emerging-issues`, { headers }),
        axios.get(`${API}/tech-fun/genome/insights`, { headers }),
        axios.get(`${API}/tech-fun/genome/contribution`, { headers }),
      ]);
      setResult({ issues: issues.data, insights: insights.data, contribution: contribution.data });
    } catch {
      toast.error("Could not read the Genome.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Dna} title="Nexus IT Genome" hint="Privacy-preserving operational intelligence: which stacks fail, what causes which symptoms, and which fixes actually work. Patterns are one-way fingerprinted and only ever surfaced as k-anonymised aggregates — no customer data leaves this page.">
      <Button size="sm" onClick={scan} disabled={busy} data-testid="genome-scan">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Dna className="mr-1 h-3 w-3" />}Scan the Genome
      </Button>
      {result && (
        <div className="mt-3 space-y-2 text-xs" data-testid="genome-result">
          <p className="text-muted-foreground">{result.contribution.patterns_contributed} anonymised pattern(s) contributed · k ≥ {result.contribution.privacy.k_anonymity_min}</p>
          {result.issues.emerging_issues.length === 0 && result.insights.insights.length === 0 && (
            <p className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">Not enough evidence yet — clusters below the anonymity floor are never reported.</p>
          )}
          {result.issues.emerging_issues.map((issue, i) => (
            <div key={i} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">
              🧬 {issue.symptom} on {issue.os_family} — {issue.baseline_note} ({issue.recent_failures}/{issue.recent_samples} recent)
            </div>
          ))}
          {result.insights.insights.map((insight, i) => (
            <div key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="font-medium">{insight.symptom} · {insight.samples} sample(s)</p>
              {insight.remedies.slice(0, 2).map((r) => (
                <p key={r.remediation_kind} className="text-muted-foreground">{r.remediation_kind}: {Math.round(r.success_rate * 100)}% success ({r.attempts} attempt(s))</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function UniversalConnector() {
  const { token } = useAuth();
  const [coverage, setCoverage] = useState(null);
  const [form, setForm] = useState({ verb: "license.assign", from_adapter: "pax8", to_adapter: "microsoft365" });
  const [swap, setSwap] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/connector/coverage`, { headers });
      setCoverage(data);
    } catch {
      toast.error("Could not load capability coverage.");
    } finally {
      setBusy(false);
    }
  };
  const planSwap = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/connector/swap-plan`, form, { headers });
      setSwap(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No swap plan for that combination.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ArrowRightLeft} title="Universal Connector" hint="One operational abstraction over every vendor. Workflows speak capability verbs — identity.user.disable, endpoint.isolate, backup.restore — so vendors become replaceable components. Coverage shows exactly what is portable today; adapters are never claimed as wired when they are not.">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="connector-coverage">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3 w-3" />}Capability coverage
        </Button>
        <Input className="h-8 w-40" value={form.verb} onChange={(e) => setForm({ ...form, verb: e.target.value })} data-testid="connector-verb" />
        <Input className="h-8 w-32" value={form.from_adapter} onChange={(e) => setForm({ ...form, from_adapter: e.target.value })} data-testid="connector-from" />
        <Input className="h-8 w-32" value={form.to_adapter} onChange={(e) => setForm({ ...form, to_adapter: e.target.value })} data-testid="connector-to" />
        <Button size="sm" onClick={planSwap} disabled={busy} data-testid="connector-swap">Swap plan</Button>
      </div>
      {coverage && (
        <div className="mt-3 text-xs" data-testid="connector-result">
          <p className="font-semibold text-sm">{coverage.verbs_portable_now}/{coverage.verbs_total} verbs portable now · {coverage.verbs_with_wired_adapter} with a wired adapter</p>
          {coverage.single_vendor_risks.length > 0 && (
            <p className="mt-1 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">
              ⚠ Single-vendor risk: {coverage.single_vendor_risks.join(", ")}
            </p>
          )}
          {swap && (
            <div className="mt-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5" data-testid="connector-swap-result">
              <p className="font-medium">{swap.from.vendor} → {swap.to.vendor} for {swap.verb} (target: {swap.to.status})</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {swap.checklist.map((step, i) => <li key={i}>• {step}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function LedgerMetering() {
  const { token } = useAuth();
  const [usage, setUsage] = useState({ meter: "endpoints.managed", quantity: 15 });
  const [share, setShare] = useState({ meter: "endpoints.managed", rate_per_unit: 2.5, platform_share_percent: 10 });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const record = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/ledger/usage`, { ...usage, quantity: Number(usage.quantity) }, { headers });
      const { data } = await axios.post(`${API}/tech-fun/ledger/revenue-share`, {
        ...share, rate_per_unit: Number(share.rate_per_unit), platform_share_percent: Number(share.platform_share_percent),
      }, { headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record usage.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Coins} title="Metering &amp; Ledger" hint="The financial plumbing for marketplace economics: idempotent usage meter events and an append-only, hash-chained double-entry ledger. Revenue-share previews use only rates you or an agreement supply — Nexus never invents pricing.">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-44" value={usage.meter} onChange={(e) => setUsage({ ...usage, meter: e.target.value })} data-testid="ledger-meter" />
        <Input className="h-8 w-20" type="number" value={usage.quantity} onChange={(e) => setUsage({ ...usage, quantity: e.target.value })} data-testid="ledger-qty" />
        <Input className="h-8 w-24" type="number" value={share.rate_per_unit} onChange={(e) => setShare({ ...share, rate_per_unit: e.target.value })} data-testid="ledger-rate" title="rate per unit (supplied by you)" />
        <Input className="h-8 w-20" type="number" value={share.platform_share_percent} onChange={(e) => setShare({ ...share, platform_share_percent: e.target.value })} data-testid="ledger-share" title="platform share %" />
        <Button size="sm" onClick={record} disabled={busy} data-testid="ledger-record">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Coins className="mr-1 h-3 w-3" />}Record &amp; preview
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="ledger-result">
          <p className="font-semibold">{result.meter}: {result.quantity} × {result.rate_per_unit} = {result.gross}</p>
          <p className="text-xs text-muted-foreground">Platform fee {result.platform_fee} ({result.platform_share_percent}%) · MSP net {result.msp_net} · {result.note}</p>
        </div>
      )}
    </Section>
  );
}

function ConsequenceEngine() {
  const { token } = useAuth();
  const [form, setForm] = useState({ action_type: "reboot", target_id: "", destructive: false });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/consequence`, form, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not model the consequences.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={AlertTriangle} title="What happens if I…?" hint="The Consequence Engine: before any action, what does clicking this button mean to the business? Incidents, agreements, recovery options and the Nexus Laws gate.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-32" value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })} placeholder="reboot · delete · retire" data-testid="con-action" />
        <Input className="h-8 w-32" value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })} placeholder="device/client ID" data-testid="con-target" />
        <Button size="sm" variant={form.destructive ? "default" : "outline"} onClick={() => setForm({ ...form, destructive: !form.destructive })} data-testid="con-destructive">
          {form.destructive ? "💥 destructive" : "not destructive"}
        </Button>
        <Button size="sm" onClick={run} disabled={busy || !form.target_id.trim()} data-testid="con-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <AlertTriangle className="mr-1 h-3 w-3" />}Model it
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="con-result">
          <p className="font-semibold">{result.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            <li className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">💰 {result.billing_implications}</li>
            <li className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">👥 {result.users_affected?.note}</li>
            {result.recovery_options?.map((r, i) => (
              <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">🛟 {r}</li>
            ))}
            {result.security_implications?.map((s, i) => (
              <li key={i} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">🔐 {s}</li>
            ))}
          </ul>
          {result.law_gate && (
            <p className={`mt-2 text-xs font-semibold ${result.law_gate.overall === "blocked" ? "text-red-300" : "text-emerald-300"}`}>
              ⚖ {result.law_gate.verdict}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function MorningCommander() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/morning-commander`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not brief the commander.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Sunrise} title="Morning Commander" hint="Not another dashboard. Nexus decides what matters today — and what can safely be handled without you.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="commander-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sunrise className="mr-1 h-3 w-3" />}Brief me
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="commander-result">
          <p className="font-semibold">{result.greeting}</p>
          <p className="text-xs text-muted-foreground">{result.estate} Overnight Nexus handled {result.overnight_handled} issue(s) without human intervention.</p>
          <ol className="mt-2 space-y-1 text-xs">
            {result.attention.map((a, i) => (
              <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                <span className={a.severity === "high" ? "text-amber-300" : "text-violet-200"}>{i + 1}. {a.line}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.verdict}</p>
          <div className="mt-2 rounded border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-1.5 text-xs">
            <p className="text-emerald-200">[Handle My Safe Stuff] — {result.safe_stuff.length} queued</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {result.safe_stuff.map((s) => <li key={s.item}>• {s.item}</li>)}
            </ul>
            <p className="mt-1 text-[10px] italic">{result.safe_note}</p>
          </div>
          {result.name_critic?.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.name_critic.map((q) => (
                <p key={q.device} className="text-xs text-violet-200/80">🏷 {q.quip}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function EndMyDay() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/end-my-day`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not run the end-of-day review.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Sunset} title="End My Day" hint="The opposite of the commander: what must not be left behind. Combine with Can I Go Home? for the full ceremony.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="endday-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sunset className="mr-1 h-3 w-3" />}Before you finish…
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="endday-result">
          <p className="font-semibold">{result.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {result.checks.map((c) => (
              <li key={c.label} className={c.ok ? "text-emerald-300" : "text-amber-300"}>
                {c.ok ? "✓" : "⚠"} {c.label} — <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
          {result.warnings.map((w, i) => (
            <div key={i} className="mt-2 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-xs">
              <p className="text-amber-200">{w.line}</p>
              <div className="mt-1 flex gap-1">
                {w.actions?.map((a) => (
                  <span key={a} className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">[{a}]</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DecisionMemory() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [decision, setDecision] = useState({ decision: "", reason: "", review_date: "", customer_accepted_risk: false });
  const [risk, setRisk] = useState({ title: "", risk_owner: "", expires: "", compensating_controls: "" });
  const [memory, setMemory] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const [decisions, risks, told] = await Promise.all([
        axios.get(`${API}/tech-fun/decisions`, { headers }),
        axios.get(`${API}/tech-fun/risk-acceptances`, { headers }),
        axios.get(`${API}/tech-fun/we-told-you`, { headers }),
      ]);
      setMemory({ decisions: decisions.data, risks: risks.data, told: told.data });
    } catch {
      toast.error("Could not load the memory.");
    } finally {
      setBusy(false);
    }
  };
  const saveDecision = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/decisions`, decision, { headers });
      toast.success("Decision recorded. Future-you will know why.");
      setDecision({ decision: "", reason: "", review_date: "", customer_accepted_risk: false });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the decision.");
      setBusy(false);
    }
  };
  const saveRisk = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/risk-acceptances`, risk, { headers });
      toast.success("Risk acceptance recorded with an expiry. It won't disappear into ticket notes.");
      setRisk({ title: "", risk_owner: "", expires: "", compensating_controls: "" });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the risk.");
      setBusy(false);
    }
  };
  return (
    <Section icon={BookOpen} title="Nexus remembers" hint="Decision log, risk acceptances and Prior Recommendation Evidence — the commercial and liability context nobody remembers six months later.">
      <div className="space-y-2">
        <Input value={decision.decision} onChange={(e) => setDecision({ ...decision, decision: e.target.value })} placeholder="decision (e.g. don't replace SERVER02 until FY27)" data-testid="mem-decision" />
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-40" value={decision.reason} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} placeholder="reason" data-testid="mem-reason" />
          <Input className="h-8 w-28" value={decision.review_date} onChange={(e) => setDecision({ ...decision, review_date: e.target.value })} placeholder="review date" data-testid="mem-review" />
          <Button size="sm" variant={decision.customer_accepted_risk ? "default" : "outline"} onClick={() => setDecision({ ...decision, customer_accepted_risk: !decision.customer_accepted_risk })} data-testid="mem-accepted">
            {decision.customer_accepted_risk ? "✓ customer accepted risk" : "customer accepted risk?"}
          </Button>
          <Button size="sm" onClick={saveDecision} disabled={busy || !decision.decision.trim()} data-testid="mem-save-decision">Record decision</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-40" value={risk.title} onChange={(e) => setRisk({ ...risk, title: e.target.value })} placeholder="accepted risk (e.g. Server 2012)" data-testid="mem-risk-title" />
          <Input className="h-8 w-28" value={risk.risk_owner} onChange={(e) => setRisk({ ...risk, risk_owner: e.target.value })} placeholder="risk owner" data-testid="mem-risk-owner" />
          <Input className="h-8 w-28" value={risk.expires} onChange={(e) => setRisk({ ...risk, expires: e.target.value })} placeholder="expires" data-testid="mem-risk-expires" />
          <Button size="sm" variant="outline" onClick={saveRisk} disabled={busy || !risk.title.trim()} data-testid="mem-save-risk">Record risk</Button>
          <Button size="sm" onClick={load} disabled={busy} data-testid="mem-load">Show memory</Button>
        </div>
      </div>
      {memory && (
        <div className="mt-3 space-y-2 text-xs" data-testid="memory-result">
          <p className="font-semibold text-violet-200">{memory.risks.verdict}</p>
          {memory.risks.acceptances?.map((r) => (
            <div key={r.id} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5">
              <span className="text-amber-200">⚠ {r.title} — owner {r.risk_owner || "unknown"}, expires {r.expires || "unspecified"}{r.review_due ? " — REVIEW DUE" : ""}</span>
              {r.compensating_controls && <p className="mt-0.5 text-muted-foreground">Controls: {r.compensating_controls}</p>}
            </div>
          ))}
          {memory.decisions.decisions?.slice(0, 3).map((d) => (
            <div key={d.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">📌 {d.decision}</span>
              <p className="mt-0.5 text-muted-foreground">Why: {d.reason}{d.customer_accepted_risk ? " · customer accepted risk" : ""}</p>
            </div>
          ))}
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
            <p className="text-violet-200">{memory.told.verdict}{memory.told.internal_note ? ` ${memory.told.internal_note}` : ""}</p>
            {memory.told.chain?.map((c, i) => (
              <p key={i} className="mt-1 text-muted-foreground">
                {c.recommendation} → {c.accepted_risk} → {c.subsequent_incidents.map((s) => `${s.number}: ${s.title}`).join(", ")}
              </p>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ============== SAFETY UX & DECISION FAMILY ==============

function WritingGuard() {
  const { token } = useAuth();
  const [draft, setDraft] = useState({ content: "", client_id: "client-001" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const scan = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/safety/writing-guard`, draft, { headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not scan the draft.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ShieldAlert} title="Writing Guard" hint="Wrong-Customer Protection: scan a draft against the customers you actually have before a human sends it. Flags cross-customer leaks — 'this content references Contoso, you are replying to ACME'. Nexus flags the mismatch, humans decide; it never claims to judge intent.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-64" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="draft text — try another customer's name" data-testid="guard-content" />
        <Input className="h-8 w-32" value={draft.client_id} onChange={(e) => setDraft({ ...draft, client_id: e.target.value })} placeholder="client ID" data-testid="guard-client" />
        <Button size="sm" onClick={scan} disabled={busy || !draft.content.trim()} data-testid="guard-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldAlert className="mr-1 h-3 w-3" />}Scan draft
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-xs" data-testid="guard-result">
          <p className={result.verdict === "clean" ? "font-semibold text-emerald-300" : "font-semibold text-amber-200"}>
            {result.verdict === "clean" ? "✓ No cross-customer references detected." : "⚠ Review required before sending"}
          </p>
          {result.warnings?.map((w, i) => (
            <p key={i} className="mt-1 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">{w.message}</p>
          ))}
          <p className="mt-1 text-muted-foreground">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function FourEyesSignOff() {
  const { token } = useAuth();
  const [form, setForm] = useState({ title: "Raise RMM alert threshold", before: "80", after: "95" });
  const [lastId, setLastId] = useState("");
  const [listing, setListing] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const request = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/safety/four-eyes`, {
        title: form.title, before: { value: form.before }, after: { value: form.after },
      }, { headers });
      setLastId(data.review_id);
      toast.success("Sign-off requested — the real diff is attached.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not request sign-off.");
    } finally {
      setBusy(false);
    }
  };
  const review = async (decision) => {
    if (!lastId) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/safety/four-eyes/${lastId}/review`, { decision }, { headers });
      toast.success(`Signed off as ${data.decision} by an independent reviewer.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Review refused.");
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/safety/four-eyes`, { headers });
      setListing(data);
    } catch {
      toast.error("Could not load sign-offs.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Scale} title="Four-Eyes Sign-Off" hint="Independent approval with the real diff — every change shows exactly what moves, at real paths. The requester can never approve their own work; try it and the API will refuse you.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-52" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="eyes-title" />
        <Input className="h-8 w-24" value={form.before} onChange={(e) => setForm({ ...form, before: e.target.value })} title="before value" data-testid="eyes-before" />
        <Input className="h-8 w-24" value={form.after} onChange={(e) => setForm({ ...form, after: e.target.value })} title="after value" data-testid="eyes-after" />
        <Button size="sm" onClick={request} disabled={busy || !form.title.trim()} data-testid="eyes-request">Request sign-off</Button>
        <Button size="sm" variant="outline" onClick={() => review("approved")} disabled={busy || !lastId} data-testid="eyes-approve">Approve</Button>
        <Button size="sm" variant="outline" onClick={() => review("rejected")} disabled={busy || !lastId} data-testid="eyes-reject">Reject</Button>
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="eyes-load">Show sign-offs</Button>
      </div>
      {listing && (
        <div className="mt-3 space-y-1.5 text-xs" data-testid="eyes-result">
          <p className="font-semibold text-violet-200">{listing.pending} pending · {listing.count} on record</p>
          {listing.sign_offs?.slice(0, 4).map((s) => (
            <div key={s.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">{s.subject} — {s.state}</span>
              <p className="mt-0.5 text-muted-foreground">
                diff: {s.diff_summary.changed} changed, {s.diff_summary.added} added, {s.diff_summary.removed} removed
                {s.decided_by ? ` · ${s.decision} by ${s.decided_by}` : ` · requested by ${s.requester}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DecisionFamily() {
  const { token } = useAuth();
  const [form, setForm] = useState({ kind: "consent_receipt", subject: "" });
  const [index, setIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const record = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/decision-family`, form, { headers });
      toast.success("Recorded in the human-decision family — one lifecycle for every decision.");
      setForm({ ...form, subject: "" });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the object.");
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/decision-family`, { headers });
      setIndex(data);
    } catch {
      toast.error("Could not load the decision family.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={History} title="Decision Family" hint="Approvals, consent receipts, risk acceptances and the decision log share one lifecycle: proposed → reviewed → decided → review-due → expired. review-due and expired derive from real dates, so nothing quietly decays into a ticket note.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-36" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} title="decision_log · risk_acceptance · approval · consent_receipt" data-testid="family-kind" />
        <Input className="h-8 w-64" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="subject (e.g. customer consented to after-hours patching)" data-testid="family-subject" />
        <Button size="sm" onClick={record} disabled={busy || !form.subject.trim()} data-testid="family-record">Record</Button>
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="family-load">Show family</Button>
      </div>
      {index && (
        <div className="mt-3 text-xs" data-testid="family-result">
          <p className="font-semibold text-violet-200">
            {index.count} object(s) · {Object.entries(index.by_state).map(([state, count]) => `${count} ${state}`).join(" · ")}
          </p>
          {index.objects?.slice(0, 4).map((o) => (
            <div key={`${o.source}-${o.id}`} className="mt-1 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">[{o.kind}] {o.subject} — {o.state}</span>
              <p className="mt-0.5 text-muted-foreground">
                {o.owner ? `owner ${o.owner}` : "no owner recorded"}
                {o.days_to_expiry != null ? ` · expires in ${o.days_to_expiry} day(s)` : ""}
              </p>
            </div>
          ))}
          <p className="mt-1 text-muted-foreground">{index.question_answered}</p>
        </div>
      )}
    </Section>
  );
}

// ============== TECHNICIAN OS: WORKBENCH · FIND · RECORDER · SYNTHETIC · RESCUE ==============

const RESCUE_SYMPTOMS = ["agent_dead", "no_boot", "network_stack", "update_broke_startup", "unknown"];

function DiagnosticWorkbench() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ symptom: "Sarah cannot access MYOB", subject_type: "device", subject_id: "dev-001" });
  const [investigation, setInvestigation] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/diagnostics/investigations`, form, { headers });
      setInvestigation(data.investigation);
      toast.success("Investigation opened — evidence moves these probabilities.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not open the investigation.");
    } finally {
      setBusy(false);
    }
  };

  const recordEvidence = async (result) => {
    const test = investigation?.next_test?.test;
    if (!test) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/diagnostics/investigations/${investigation.id}/evidence`,
        { test, result }, { headers });
      setInvestigation(data.investigation);
      toast.success(result === "inconclusive" ? "Recorded — it changed nothing, honestly." : "Hypotheses updated.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the evidence.");
    } finally {
      setBusy(false);
    }
  };

  const close = async (outcome) => {
    if (!investigation) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/diagnostics/investigations/${investigation.id}/close`,
        { outcome, root_cause: investigation.root_cause?.domain || "" }, { headers });
      setInvestigation(data.investigation);
      toast.success(`Closed as ${data.investigation.closed_outcome}.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not close it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Stethoscope} title="Diagnostic Workbench" hint="One investigation instead of eighty tools: the plausible cause domains, the evidence recorded so far, and the single next test that eliminates the most uncertainty. Probabilities are arithmetic on published heuristics — unrecorded tests never count as passed.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-64" value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} placeholder="symptom" data-testid="inv-symptom" />
        <select className="h-8 rounded-md border border-border bg-card px-2 text-xs" value={form.subject_type} onChange={(e) => setForm({ ...form, subject_type: e.target.value })} data-testid="inv-subject-type">
          <option value="device">device</option>
          <option value="user">user</option>
          <option value="client">client</option>
        </select>
        <Input className="h-8 w-32" value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} placeholder="subject ID" data-testid="inv-subject-id" />
        <Button size="sm" onClick={open} disabled={busy || !form.symptom.trim() || !form.subject_id.trim()} data-testid="inv-open">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Stethoscope className="mr-1 h-3 w-3" />}Open investigation
        </Button>
      </div>
      {investigation && (
        <div className="mt-3 space-y-2 text-xs" data-testid="inv-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{investigation.id}</Badge>
            <span className="text-muted-foreground">{investigation.status} · {investigation.evidence_count} evidence</span>
            {investigation.isolated && <Badge className="bg-emerald-500/20 text-emerald-300">root cause isolated</Badge>}
          </div>
          {investigation.hypotheses.map((h) => (
            <div key={h.domain}>
              <div className="flex items-center justify-between">
                <span className="text-violet-200">{h.label}</span>
                <span className="text-muted-foreground">{(h.probability * 100).toFixed(1)}%</span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-violet-500/10">
                <div className="h-full bg-violet-400/70" style={{ width: `${h.probability * 100}%` }} />
              </div>
            </div>
          ))}
          {investigation.next_test ? (
            <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="text-violet-200">Next best test: {investigation.next_test.label} (+{investigation.next_test.expected_information_gain} bits)</p>
              <p className="mt-0.5 text-muted-foreground">Evidence source: {investigation.next_test.source}</p>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => recordEvidence("abnormal")} disabled={busy} data-testid="inv-abnormal">Abnormal</Button>
                <Button size="sm" variant="outline" onClick={() => recordEvidence("normal")} disabled={busy} data-testid="inv-normal">Normal</Button>
                <Button size="sm" variant="outline" onClick={() => recordEvidence("inconclusive")} disabled={busy} data-testid="inv-inconclusive">Could not test</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No remaining test can change the answer — fix it and re-run the discriminating test to verify.</p>
          )}
          {investigation.status === "open" && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => close("resolved")} disabled={busy || !investigation.isolated} data-testid="inv-resolve">Resolve</Button>
              <Button size="sm" variant="outline" onClick={() => close("inconclusive")} disabled={busy} data-testid="inv-inconclusive-close">Close unresolved</Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function FindEverywhere() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [query, setQuery] = useState("192.168.1.14");
  const [result, setResult] = useState(null);
  const [literals, setLiterals] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/find`, { params: { q: query }, headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const hunt = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/find/literals`, { kind: "auto" }, { headers });
      setLiterals(data);
      toast.success(`${data.count} hardcoded literal(s) found in the stores Nexus can see.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Scan failed.");
    } finally {
      setBusy(false);
    }
  };

  const impact = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/find/change-impact`, { value: query }, { headers });
      setResult({ groups: data.groups, total: data.total, empty: data.empty, note: data.note });
      toast(data.risk_band.reason);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not work out the impact.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Crosshair} title="Find Everywhere" hint="Where else does this value appear? One IP, hostname or domain across every store Nexus owns — then what breaks if you change it. Nexus cannot see hardcoded values inside applications, appliances or firmware, and says so rather than implying clean.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="IP, hostname or domain" data-testid="find-query" />
        <Button size="sm" onClick={search} disabled={busy || !query.trim()} data-testid="find-search">Search every store</Button>
        <Button size="sm" variant="outline" onClick={impact} disabled={busy || !query.trim()} data-testid="find-impact">Change impact</Button>
        <Button size="sm" variant="outline" onClick={hunt} disabled={busy} data-testid="find-hunt">Hunt hardcoded literals</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs" data-testid="find-result">
          <p className="font-semibold text-violet-200">{result.total} reference(s) across {result.groups?.length || 0} store(s)</p>
          {result.groups?.map((group) => (
            <div key={group.source} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">{group.label} ({group.count}) · {group.owner}</span>
              {group.hits.slice(0, 3).map((hit) => (
                <p key={hit.id} className="mt-0.5 text-muted-foreground">{hit.label} — {hit.matched_fields.join(", ")}</p>
              ))}
            </div>
          ))}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
      {literals && (
        <div className="mt-3 space-y-1 text-xs" data-testid="find-literals">
          <p className="font-semibold text-amber-200">{literals.count} literal(s) in {literals.scanned?.documents} document(s)</p>
          {literals.literals?.slice(0, 6).map((item) => (
            <p key={`${item.kind}-${item.value}`} className="text-muted-foreground">
              {item.value} · {item.kind}{item.private ? " · private" : ""} · {item.occurrences}× in {item.sources.join(", ")}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

function CommandRecorder() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ label: "Print spooler hangs", device_id: "dev-001" });
  const [session, setSession] = useState(null);
  const [command, setCommand] = useState("Restart-Service Spooler -Force");
  const [runbook, setRunbook] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions`, { ...form, kind: "manual_fix" }, { headers });
      setSession(data.session);
      setRunbook(null);
      toast.success("Recording. Secrets are redacted before anything is stored.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not start recording.");
    } finally {
      setBusy(false);
    }
  };

  const step = async (kind) => {
    if (!session) return;
    setBusy(true);
    try {
      const payload = kind === "command" ? { kind, command } : { kind, detail: "test page printed" };
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions/${session.id}/steps`, payload, { headers });
      setSession(data.session);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the step.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions/${session.id}/end`, { outcome: "success" }, { headers });
      setSession(data.session);
      toast.success(data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not close the session.");
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions/${session.id}/runbook`, {}, { headers });
      setRunbook(data.runbook);
      toast.success("Draft runbook proposed — a human must review it.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not draft a runbook.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!runbook) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/runbooks/${runbook.id}/verify`, { outcome: "success" }, { headers });
      setRunbook(data.runbook);
      toast(data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not verify.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Radio} title="Command Recorder" hint="Fix it by hand, and Nexus asks the useful question: save this as a runbook? Recorded steps become prerequisites, variables, actions, verification and rollback. Three verified successes make it an autonomy candidate — never autonomous without explicit approval.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-52" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="what are you fixing" data-testid="rec-label" />
        <Input className="h-8 w-28" value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })} placeholder="device ID" data-testid="rec-device" />
        <Button size="sm" onClick={start} disabled={busy || !form.label.trim()} data-testid="rec-start">Start recording</Button>
      </div>
      {session && (
        <div className="mt-3 space-y-2 text-xs" data-testid="rec-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{session.id}</Badge>
            <span className="text-muted-foreground">{session.status} · {session.steps.length} step(s){session.outcome ? ` · ${session.outcome}` : ""}</span>
          </div>
          {session.status === "recording" && (
            <div className="flex flex-wrap gap-2">
              <Input className="h-8 w-64" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command" data-testid="rec-command" />
              <Button size="sm" variant="outline" onClick={() => step("command")} disabled={busy} data-testid="rec-step">Record command</Button>
              <Button size="sm" variant="outline" onClick={() => step("verification")} disabled={busy} data-testid="rec-verify-step">Record verification</Button>
              <Button size="sm" variant="outline" onClick={finish} disabled={busy} data-testid="rec-end">End — it worked</Button>
            </div>
          )}
          {session.steps.map((s) => (
            <p key={s.index} className="text-muted-foreground">{s.index}. [{s.kind}] {s.command || s.detail}</p>
          ))}
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={propose} disabled={busy} data-testid="rec-propose">Save as runbook</Button>
            <Button size="sm" variant="outline" onClick={verify} disabled={busy || !runbook} data-testid="rec-verify">Verify success</Button>
          </div>
          {runbook && (
            <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5" data-testid="rec-runbook">
              <p className="text-violet-200">{runbook.id} · {runbook.status} · {runbook.verified_successes} verified success(es){runbook.autonomy_candidate ? " · autonomy candidate" : ""}</p>
              <p className="mt-0.5 text-muted-foreground">prerequisites: {runbook.prerequisites?.length || 0} · variables: {(runbook.variables || []).join(", ") || "none"} · actions: {runbook.actions?.length || 0} · verification: {runbook.verification?.length || 0} · rollback: {runbook.rollback?.length || 0}</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function SyntheticEmployee() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ label: "Payroll workflow", client_id: "client-001", checks: "authenticate,send_test_mail" });
  const [identity, setIdentity] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const register = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/synthetic/identities`, {
        label: form.label, client_id: form.client_id,
        checks: form.checks.split(",").map((c) => c.trim()).filter(Boolean),
      }, { headers });
      setIdentity(data.identity);
      toast.success("Test identity registered — by vault reference, never a credential.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not register the identity.");
    } finally {
      setBusy(false);
    }
  };

  const run = async (failLast) => {
    if (!identity) return;
    const checks = identity.checks || [];
    setBusy(true);
    try {
      const results = checks.map((check, index) => ({
        check,
        verdict: failLast && index === checks.length - 1 ? "fail" : "pass",
        detail: failLast && index === checks.length - 1 ? "relay refused" : "",
      }));
      const { data } = await axios.post(`${API}/tech-fun/synthetic/runs`, { identity_id: identity.id, results }, { headers });
      toast(data.run.business_statement);
      const { data: fresh } = await axios.get(`${API}/tech-fun/synthetic/identities/${identity.id}`, { headers });
      setStatus(fresh);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={UserCheck} title="Synthetic Employee" hint="Not 'server responds' — 'the payroll application actually works'. A test identity runs safe read-only business checks and reports an honest verdict: partial evidence is never called healthy.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-44" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="business workflow" data-testid="syn-label" />
        <Input className="h-8 w-28" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} placeholder="client ID" data-testid="syn-client" />
        <Input className="h-8 w-64" value={form.checks} onChange={(e) => setForm({ ...form, checks: e.target.value })} placeholder="checks, comma separated" data-testid="syn-checks" />
        <Button size="sm" onClick={register} disabled={busy || !form.label.trim()} data-testid="syn-register">Register identity</Button>
      </div>
      {identity && (
        <div className="mt-3 space-y-2 text-xs" data-testid="syn-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{identity.id}</Badge>
            <span className="text-muted-foreground">{identity.checks.join(", ")} · every {(identity.interval_minutes || 30)} min</span>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => run(false)} disabled={busy} data-testid="syn-pass">Record a healthy run</Button>
            <Button size="sm" variant="outline" onClick={() => run(true)} disabled={busy} data-testid="syn-fail">Record a failing run</Button>
          </div>
          {status?.latest_run && (
            <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="text-violet-200">{status.latest_run.verdict} — {status.latest_run.business_statement}</p>
              <p className="mt-0.5 text-muted-foreground">coverage: {status.latest_run.coverage?.ran}/{status.latest_run.coverage?.declared} ran · {status.latest_run.coverage?.unavailable} unavailable</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function NexusRescue() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ device_id: "dev-001", symptom: "no_boot" });
  const [assessment, setAssessment] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);

  const assess = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/rescue/assess`, form, { headers });
      setAssessment(data);
      setSession(null);
      toast(data.reachability_note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not assess the device.");
    } finally {
      setBusy(false);
    }
  };

  const plan = async () => {
    setBusy(true);
    try {
      const reachable = (assessment?.capabilities || []).filter((c) => c.reachable).map((c) => c.capability);
      const { data } = await axios.post(`${API}/tech-fun/rescue/sessions`, {
        ...form, capabilities: reachable.slice(0, 2).length ? reachable.slice(0, 2) : ["collect_logs"],
      }, { headers });
      setSession(data.session);
      toast.success(data.note || "Recovery planned — Nexus never claims a remote execution.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not plan the recovery.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={LifeBuoy} title="Nexus Rescue" hint="What happens when the machine is broken badly enough that the agent does not work. Nexus reports only what is actually reachable from real evidence and produces a reviewed recovery plan — it never claims a remote execution the agent cannot perform.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-28" value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })} placeholder="device ID" data-testid="rescue-device" />
        <select className="h-8 rounded-md border border-border bg-card px-2 text-xs" value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} data-testid="rescue-symptom">
          {RESCUE_SYMPTOMS.map((symptom) => <option key={symptom} value={symptom}>{symptom}</option>)}
        </select>
        <Button size="sm" onClick={assess} disabled={busy || !form.device_id.trim()} data-testid="rescue-assess">Assess reachability</Button>
        <Button size="sm" variant="outline" onClick={plan} disabled={busy || !assessment} data-testid="rescue-plan">Plan recovery</Button>
      </div>
      {assessment && (
        <div className="mt-3 space-y-2 text-xs" data-testid="rescue-result">
          <div className="flex items-center gap-2">
            <Badge className={assessment.agent_reachable ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}>
              {assessment.agent_reachable ? "agent reachable" : "agent not reachable"}
            </Badge>
            <span className="text-muted-foreground">{assessment.symptom}</span>
          </div>
          <p className="text-muted-foreground">{assessment.reachability_note}</p>
          <p className="text-muted-foreground">out-of-band required: {assessment.out_of_band_required?.join(", ") || "none"}</p>
          <div className="flex flex-wrap gap-1">
            {(assessment.capabilities || []).map((c) => (
              <span key={c.capability} className={`rounded border px-1.5 py-0.5 ${c.reachable ? "border-emerald-500/30 text-emerald-300" : "border-border text-muted-foreground"}`}>
                {c.capability}
              </span>
            ))}
          </div>
          <p className="text-muted-foreground">recommended path: {(assessment.recommended_path || []).join(" → ")}</p>
        </div>
      )}
      {session && (
        <div className="mt-3 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs" data-testid="rescue-session">
          <p className="text-violet-200">{session.id} · {session.status} · approval required</p>
          <p className="mt-0.5 text-muted-foreground">{(session.capabilities || []).map((c) => c.capability || c).join(", ")}</p>
        </div>
      )}
    </Section>
  );
}

// ============== ORCHESTRATION & TRUST: INVESTIGATE · STATE · FLEET · EVIDENCE · MODE ==============

function MissionControlInvestigate() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [problem, setProblem] = useState("Sarah cannot access Finance");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const investigate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/mission-control/investigate`, { problem }, { headers });
      setResult(data);
      toast(data.resolved ? "Scope assembled from real records." : "Opened as awaiting subject — no device was invented.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not investigate that.");
    } finally {
      setBusy(false);
    }
  };

  const investigation = result?.investigation;
  return (
    <Section icon={Radar} title="Mission Control · Investigate" hint="Stop deciding which of eighty tools to open. Describe what appears wrong and Nexus assembles the scope, the tools worth opening, the hypotheses and the single next action — and says plainly when a human must decide instead of Nexus.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-72" value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="tell Nexus what appears wrong" data-testid="mci-problem" />
        <Button size="sm" onClick={investigate} disabled={busy || !problem.trim()} data-testid="mci-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Radar className="mr-1 h-3 w-3" />}Investigate
        </Button>
      </div>
      {investigation && (
        <div className="mt-3 space-y-2 text-xs" data-testid="mci-result">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{investigation.id}</Badge>
            <span className="text-muted-foreground">{investigation.status}</span>
            {investigation.subject?.label && <Badge className="bg-violet-500/20 text-violet-200">{investigation.subject.type}: {investigation.subject.label}</Badge>}
          </div>
          {investigation.scope?.rows?.map((row) => (
            <div key={row.kind} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">{row.kind} · {row.count}</span>
              <p className="mt-0.5 text-muted-foreground">{row.detail} <span className="opacity-60">({row.source})</span></p>
            </div>
          ))}
          <p className="text-muted-foreground">Next: <span className="text-violet-200">{investigation.next_action?.action}</span>
            {investigation.next_action?.execution_permitted === false ? " · execution not permitted right now" : ""}
          </p>
          {investigation.human_decision?.required && (
            <div className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">
              <p className="font-semibold">Human decision required</p>
              {investigation.human_decision.reasons?.map((reason, index) => (
                <p key={index} className="mt-0.5">{reason.reason} — {reason.detail}</p>
              ))}
            </div>
          )}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function StateEngineDrift() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [deviceId, setDeviceId] = useState("dev-001");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const evaluate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/state-engine/evaluate/${deviceId}`, { headers });
      setResult(data);
      toast(`met ${data.counts.met} · drifted ${data.counts.drifted} · unverified ${data.counts.unverified}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not evaluate that device.");
    } finally {
      setBusy(false);
    }
  };

  const proposes = async (driftId) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/drift/${driftId}/remediation`,
        { action: "Re-apply the declared baseline and restart the affected service", rollback: "Restore the previous configuration" }, { headers });
      toast(data.permitted ? "Plan stored. Nexus executes nothing — a human does." : data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not propose remediation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Activity} title="State Engine · Drift Control" hint="Declare what a device should look like and reconcile it continuously: desired → actual → difference → remediation → verification. A check with no evidence in the record is reported unverified — Nexus never infers protection from a missing field.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-32" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device ID" data-testid="state-device" />
        <Button size="sm" onClick={evaluate} disabled={busy || !deviceId.trim()} data-testid="state-evaluate">Evaluate device</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs" data-testid="state-result">
          <p className="font-semibold text-violet-200">
            {result.counts.met} met · {result.counts.drifted} drifted · {result.counts.unverified} unverified
          </p>
          {result.checks.map((check) => (
            <div key={check.check} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className={check.verdict === "met" ? "text-emerald-300" : check.verdict === "drifted" ? "text-amber-200" : "text-muted-foreground"}>
                {check.label} — {check.verdict}
              </span>
              <p className="mt-0.5 text-muted-foreground">expected {check.expected || "—"} · observed {check.observed ?? "no evidence"}</p>
            </div>
          ))}
          {result.drift?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.drift.map((finding) => (
                <Button key={finding.id} size="sm" variant="outline" onClick={() => proposes(finding.id)} disabled={busy} data-testid={`state-plan-${finding.check}`}>
                  Plan fix: {finding.check}
                </Button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function FleetShell() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [days, setDays] = useState(30);
  const [result, setResult] = useState(null);
  const [refined, setRefined] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/fleet/query`,
        { filters: [{ filter: "days_since_boot_gte", value: Number(days) }] }, { headers });
      setResult(data);
      setRefined(null);
      toast(`${data.count} device(s) — the answer is an object set, not a CSV.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not query the fleet.");
    } finally {
      setBusy(false);
    }
  };

  const refine = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const saved = await axios.post(`${API}/tech-fun/fleet/sets`,
        { label: `Not rebooted in ${days} days`, filters: [{ filter: "days_since_boot_gte", value: Number(days) }] }, { headers });
      const { data } = await axios.post(`${API}/tech-fun/fleet/sets/${saved.data.object_set.id}/refine`,
        { filters: [{ filter: "exclude_servers" }, { filter: "exclude_active_user" }] }, { headers });
      setRefined(data.object_set);
      toast(`${data.object_set.member_count} remain after excluding servers and active users.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not refine the set.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Waypoints} title="Fleet Shell" hint="Not terminal access — a question across the fleet whose answer is an actionable object set. Refine it, and a device the fleet has no evidence about is reported as unavailable rather than quietly counted or dropped.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-32" type="number" value={days} onChange={(e) => setDays(e.target.value)} title="days since boot" data-testid="fleet-days" />
        <Button size="sm" onClick={ask} disabled={busy} data-testid="fleet-ask">Which endpoints haven&apos;t rebooted?</Button>
        <Button size="sm" variant="outline" onClick={refine} disabled={busy || !result} data-testid="fleet-refine">Exclude servers &amp; active users</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs" data-testid="fleet-result">
          <p className="font-semibold text-violet-200">{result.count} device(s) in the answer</p>
          <p className="text-muted-foreground">
            excluded — servers {result.excluded?.servers || 0}, active user {result.excluded?.active_user || 0},
            no evidence {result.excluded?.unavailable || 0}
          </p>
          {result.devices?.slice(0, 5).map((device) => (
            <p key={device.id} className="text-muted-foreground">{device.hostname} · {device.client_name || device.client_id}</p>
          ))}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
      {refined && (
        <div className="mt-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs" data-testid="fleet-refined">
          <p className="text-violet-200">{refined.id} · {refined.member_count} of {refined.lineage ? "the original set" : "—"}</p>
          <p className="mt-0.5 text-muted-foreground">A new set was created; the original was not modified.</p>
        </div>
      )}
    </Section>
  );
}

function EvidenceEngine() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ operation: "restart_spooler", target_id: "dev-001" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const record = async (observeSecond) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/evidence`, {
        operation: form.operation, target_type: "device", target_id: form.target_id,
        method: "agent command", actor_kind: "technician", outcome: "success",
        required_checks: ["service_running", "service_autostart"],
        checks: observeSecond
          ? [{ check: "service_running", observed: true }, { check: "service_autostart", observed: true }]
          : [{ check: "service_running", observed: true }],
      }, { headers });
      const verified = await axios.post(`${API}/tech-fun/evidence/${data.evidence.id}/verify`, {}, { headers });
      setResult({ evidence: data.evidence, verdict: verified.data.verdict });
      toast(`${verified.data.verdict.verdict}: ${verified.data.verdict.reason}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the evidence.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={BadgeCheck} title="Evidence Engine" hint='Proof that an operation actually succeeded, instead of “the script exited zero”. A verdict is verified only when every required check carries a real observation — a success with an unobserved check is partial, not proven.'>
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-44" value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value })} placeholder="operation" data-testid="evidence-operation" />
        <Input className="h-8 w-28" value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })} placeholder="target ID" data-testid="evidence-target" />
        <Button size="sm" onClick={() => record(false)} disabled={busy} data-testid="evidence-partial">Prove it — one check observed</Button>
        <Button size="sm" variant="outline" onClick={() => record(true)} disabled={busy} data-testid="evidence-proven">Prove it — all checks observed</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs" data-testid="evidence-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{result.evidence.id}</Badge>
            <Badge className={result.verdict.verdict === "verified" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}>
              {result.verdict.verdict}
            </Badge>
          </div>
          <p className="text-muted-foreground">{result.verdict.reason}</p>
          <p className="text-muted-foreground">observed: {result.verdict.observed_checks?.join(", ") || "none"} · required: {result.verdict.required_checks?.join(", ")}</p>
          <p className="text-muted-foreground">entry hash {String(result.evidence.chain?.entry_hash || "").slice(0, 16)}… (hash-chained per tenant)</p>
        </div>
      )}
    </Section>
  );
}

function OperationalMode() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [reason, setReason] = useState("suspected compromise under investigation");
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/operational-mode`, { headers });
      setMode(data.mode);
    } catch {
      toast.error("Could not read the operational mode.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (next) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/operational-mode`,
        { mode: next, reason, capabilities: next === "frozen" ? ["software_deployment"] : [] }, { headers });
      setMode(data.mode);
      toast(data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Mode change refused.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Lock} title="Operational Mode · Safe Mode" hint="Deterministic control during an incident: normal, observe-only (Nexus detects and recommends but executes nothing), or a scoped freeze. A written reason is mandatory, and the response states honestly which layers consult it and which still do not.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-72" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why are you stopping things" data-testid="ops-reason" />
        <Button size="sm" onClick={() => apply("observe_only")} disabled={busy || !reason.trim()} data-testid="ops-observe">Observe only</Button>
        <Button size="sm" variant="outline" onClick={() => apply("frozen")} disabled={busy || !reason.trim()} data-testid="ops-freeze">Freeze software deployment</Button>
        <Button size="sm" variant="outline" onClick={() => apply("normal")} disabled={busy || !reason.trim()} data-testid="ops-normal">Resume normal</Button>
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="ops-load">Show mode</Button>
      </div>
      {mode && (
        <div className="mt-3 text-xs" data-testid="ops-result">
          <p className="font-semibold text-violet-200">
            {mode.mode}{mode.frozen_capabilities?.length ? ` · ${mode.frozen_capabilities.join(", ")}` : ""}
            {mode.frozen_clients?.length ? ` · ${mode.frozen_clients.join(", ")}` : ""}
          </p>
          {mode.reason && <p className="mt-0.5 text-muted-foreground">reason: {mode.reason}</p>}
          <p className="mt-1 text-muted-foreground">{mode.note}</p>
        </div>
      )}
    </Section>
  );
}

// ============== PAGE ==============

export default function TechToolboxPage() {
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) playSound("coin");
  };

  return (
    <PageShell>
      <div className="space-y-4" data-testid="tech-toolbox-page">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1 flex items-center gap-2">
              <Gamepad2 className="w-3 h-3" />Tech Toolbox
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Toys, tools & tiny triumphs</h1>
            <p className="text-sm text-muted-foreground">
              Everything here runs on real Nexus data — the wheel picks real tickets, the arcade measures real latency,
              and every point lands in the real ledger.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={toggleSound} data-testid="sound-toggle" title={soundOn ? "Mute delight sounds" : "Enable delight sounds (off by default)"}>
            {soundOn ? <Volume2 className="mr-1 h-3 w-3" /> : <VolumeX className="mr-1 h-3 w-3" />}
            {soundOn ? "Sounds on" : "Sounds off"}
          </Button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <AlertTriage />
          <BlastRadius />
          <WorkLocks />
          <HandoverDigest />
          <CustomerCost />
          <BehaviourBaseline />
          <SomethingFeelsWrong />
          <UniversalTimeline />
          <UniversalSearch />
          <SessionSidecar />
          <WhileYoureThere />
          <DependencyHorizon />
          <AgreementMargin />
          <TechnicalDebt />
          <KnowledgeCoverage />
          <ProveIt />
          <ConfidenceReport />
          <TicketIntelligence />
          <NoiseBudget />
          <TicketCorrelation />
          <AuditReadiness />
          <NexusLaws />
          <CredentialGuard />
          <RealityChecks />
          <ConsequenceEngine />
          <MorningCommander />
          <EndMyDay />
          <DecisionMemory />
          <WritingGuard />
          <FourEyesSignOff />
          <DecisionFamily />
          <MissionControlInvestigate />
          <DiagnosticWorkbench />
          <FindEverywhere />
          <StateEngineDrift />
          <FleetShell />
          <EvidenceEngine />
          <OperationalMode />
          <CommandRecorder />
          <SyntheticEmployee />
          <NexusRescue />
          <IntentOS />
          <ITGenome />
          <UniversalConnector />
          <LedgerMetering />
          <ProtocolRegistry />
          <NexusNativeCertification />
          <GoHomeCheck />
          <WeekendRisk />
          <CaughtUp />
          <MemoryPin />
          <ChangeRisk />
          <NopeButton />
          <LabsFlags />
          <NoteTranslator />
          <IsItDns />
          <RealityCheck />
          <BossBattles />
          <DevicePersonality />
          <Celebrations />
          <WheelOfTickets />
          <FocusMode />
          <PingArcade />
          <LabelPrinter />
          <TechCardPanel />
          <WinWall />
          <NetworkWeather />
          <SeasonStandings />
          <Speedruns />
        </div>
      </div>
    </PageShell>
  );
}
