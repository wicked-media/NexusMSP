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
  Dices, Focus, Gamepad2, QrCode, IdCard, Trophy, CloudSun, Timer, Loader2, Download, Printer, Zap, Moon,
} from "lucide-react";
import { playSound } from "@/lib/sounds";
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

// ============== PAGE ==============

export default function TechToolboxPage() {
  return (
    <PageShell>
      <div className="space-y-4" data-testid="tech-toolbox-page">
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
        <div className="grid gap-4 xl:grid-cols-2">
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
