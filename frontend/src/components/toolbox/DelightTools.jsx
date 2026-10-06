import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DevicePicker from "@/components/DevicePicker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dices, Focus, Gamepad2, QrCode, IdCard, Trophy, CloudSun, Timer, Loader2, Download, Printer, Zap, Moon,
  Languages, Network, ShieldCheck, Swords, Server, PartyPopper,
  Waypoints, BadgeCheck,
} from "lucide-react";
import { playSound } from "@/lib/sounds";
import { buildTechCardSvg, techCardFilename } from "@/lib/techCard";
import { Section } from "./toolboxShared";

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
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="verify-device" />
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
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="personality-device" />
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

export {
  WEATHER,
  WIN_KINDS,
  WheelOfTickets,
  FocusMode,
  PingArcade,
  LabelPrinter,
  ProtocolRegistry,
  NexusNativeCertification,
  TechCardPanel,
  WinWall,
  NetworkWeather,
  SeasonStandings,
  Speedruns,
  NoteTranslator,
  IsItDns,
  RealityCheck,
  BossBattles,
  DevicePersonality,
  Celebrations,
};
