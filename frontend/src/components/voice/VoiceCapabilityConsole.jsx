import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import {
  VOICE_COLUMN_LIMIT,
  VOICE_ROW_LIMIT,
  artifactFor,
  cellValue,
  resultRows,
} from "@/lib/voiceCapability";
import { AlertTriangle, Loader2, Play, Search, Sparkles, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import {
  LEARNING_ACTION,
  LEARNING_VIEW,
  learningHint,
  learningSlug,
  mostUsed,
  rankByUse,
} from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

/**
 * The remembered identifier for a capability family.
 *
 * Families are a different kind of choice from an interface, so they get their
 * own prefix: a family named `Recording` and an interface named
 * `recording.list` are two separate pieces of evidence, not one.
 */
const familyTarget = (category) => learningSlug(`family_${category}`);

/**
 * The provider's own identifiers are dotted (`extension.list`), which is how the
 * catalogue names them and how the console shows them. The workspace memory
 * stores short slugs, so the console converts once at each boundary — what it
 * records and what it reads are then the same key.
 */
const operationTarget = (operation) => learningSlug(operation.id);

/** The interface a family opens on when nothing has been chosen yet. */
function firstRunnableIn(items = []) {
  return items.find((item) => !item.proxied && item.access === "read")
    || items.find((item) => !item.proxied)
    || items[0];
}

/**
 * PBX capability console.
 *
 * The catalogue is 139 interfaces behind ten families, which is more than one
 * screen can show. Nexus remembers the family and the interface a technician
 * actually works in and opens the console there, and orders the interfaces of
 * the current family around that evidence, so a technician who lives in
 * `extension.list` stops scrolling for it every time.
 *
 * Two safety rules are deliberately kept in front of the memory:
 *
 *   - With no evidence the console lands exactly where it always did, on the
 *     read-only Extension roster, so a first visit cannot invite a command.
 *   - A destructive or artifact-route interface is never preselected, however
 *     often it is used; removing provider state stays one deliberate click away.
 */
export default function VoiceCapabilityConsole({
  api,
  headers,
  pbxs = [],
  pbxId,
  onPbxChange,
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
}) {
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState(false);
  const [catalogueBusy, setCatalogueBusy] = useState(true);
  const [category, setCategory] = useState("");
  const [operationId, setOperationId] = useState("");
  const [operationQuery, setOperationQuery] = useState("");
  const [values, setValues] = useState({});
  const [body, setBody] = useState("");
  const [result, setResult] = useState(null);
  const [runBusy, setRunBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [audio, setAudio] = useState(null);
  const [audioBusy, setAudioBusy] = useState("");

  const loadCatalogue = useCallback(async () => {
    setCatalogueBusy(true);
    setCatalogueError(false);
    try {
      const { data } = await axios.get(`${api}/yeastar/catalogue`, { headers });
      setCatalogue(data);
    } catch {
      setCatalogue(null);
      setCatalogueError(true);
    } finally {
      setCatalogueBusy(false);
    }
  }, [api, headers]);

  useEffect(() => { loadCatalogue(); }, [loadCatalogue]);

  // A previously loaded audio clip belongs to the previous selection, so it is
  // released as soon as the operator moves on.
  useEffect(() => () => { if (audio?.url) URL.revokeObjectURL(audio.url); }, [audio]);

  const familyRankOptions = useMemo(
    () => ({ surface: LEARNING_VIEW, personal, team, idOf: (item) => familyTarget(item.category) }),
    [personal, team],
  );
  const operationRankOptions = useMemo(
    () => ({ surface: LEARNING_VIEW, personal, team, idOf: operationTarget }),
    [personal, team],
  );
  const families = useMemo(() => catalogue?.categories || [], [catalogue]);
  // Opening on a family that only changes state would invite an accidental
  // command, so with no evidence the console lands on the extension roster, as
  // it always has. Only real evidence moves it.
  const rememberedFamily = useMemo(
    () => (category ? null : mostUsed(families, familyRankOptions)),
    [category, families, familyRankOptions],
  );
  const family = useMemo(
    () => families.find((item) => item.category === category) || rememberedFamily || families.find((item) => item.category === "Extension") || families[0],
    [families, category, rememberedFamily],
  );
  // The strongest evidence about any interface of the current family, so the
  // console can say honestly whether it landed somewhere it remembers.
  const rememberedOperation = useMemo(
    () => mostUsed(family?.operations || [], operationRankOptions),
    [family, operationRankOptions],
  );
  const hint = learningHint({ surface: LEARNING_VIEW, personal, team });
  const familyOperations = useMemo(() => rankByUse(family?.operations || [], operationRankOptions).filter((operation) => {
    const needle = operationQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${operation.id} ${operation.summary}`.toLowerCase().includes(needle);
  }), [family, operationQuery, operationRankOptions]);
  const operation = useMemo(
    () => (family?.operations || []).find((item) => item.id === operationId),
    [family, operationId],
  );

  // Keep a valid selection whenever the catalogue, the family or the memory
  // changes. A remembered interface is only landed on when it cannot remove
  // provider state, and only while the technician is still sitting on the
  // family's safe default — a selection they made themselves is never taken away.
  useEffect(() => {
    if (!family) return;
    const safeRemembered = rememberedOperation && !rememberedOperation.destructive && !rememberedOperation.proxied
      ? rememberedOperation
      : null;
    if (family.operations.some((item) => item.id === operationId)) {
      // The technician already has a valid interface open. Only the family's
      // untouched safe default may be replaced by the remembered one.
      if (!safeRemembered || operationId !== firstRunnableIn(family.operations)?.id) return;
      if (safeRemembered.id === operationId) return;
    }
    setOperationId((safeRemembered || firstRunnableIn(family.operations))?.id || "");
    setValues({});
    setBody("");
    setResult(null);
  }, [family, operationId, rememberedOperation]);

  const selectOperation = (next) => {
    setOperationId(next.id);
    setValues({});
    setBody("");
    setResult(null);
    onRecordAction?.(LEARNING_VIEW, operationTarget(next));
  };

  const declaredParams = operation?.params || [];
  const missingRequired = declaredParams.filter((key) => !String(values[key] ?? "").trim());

  const listen = async (kind, artifactId, extensionId) => {
    if (!pbxId || !artifactId) return;
    setAudioBusy(artifactId);
    try {
      const response = await axios.get(`${api}/voice/audio/${kind}/${encodeURIComponent(artifactId)}`, {
        headers,
        params: { pbx_id: pbxId, ext_id: extensionId || "" },
        responseType: "blob",
      });
      setAudio({ url: URL.createObjectURL(response.data), label: `${kind} ${artifactId}` });
    } catch (error) {
      // An artifact failure is also a Blob response, so read its JSON body.
      let detail = error?.response?.data?.detail;
      if (!detail && typeof error?.response?.data?.text === "function") {
        try { detail = JSON.parse(await error.response.data.text())?.detail; } catch { detail = ""; }
      }
      toast.error(detail || "The PBX did not hand back that audio. Nexus recorded the attempt in the audit ledger.");
    } finally {
      setAudioBusy("");
    }
  };

  const run = async () => {
    if (!operation) return;
    if (!pbxId) { toast.error("Choose a client PBX before running a PBX interface"); return; }
    if (missingRequired.length) { toast.error(`Fill in ${missingRequired.join(", ")} first`); return; }
    if (operation.destructive && !confirmOpen) { setConfirmOpen(true); return; }

    const params = { pbx_id: pbxId };
    declaredParams.forEach((key) => { if (String(values[key] ?? "").trim()) params[key] = values[key]; });

    setRunBusy(true);
    try {
      let response;
      if (operation.access === "write") {
        let payload = {};
        if (body.trim()) {
          try { payload = JSON.parse(body); } catch { toast.error("The request body must be valid JSON"); setRunBusy(false); return; }
        }
        response = await axios.post(`${api}/yeastar/operations/${operation.id}`, payload, { headers, params });
      } else {
        response = await axios.get(`${api}/yeastar/operations/${operation.id}`, { headers, params });
      }
      setResult(response.data);
      setConfirmOpen(false);
      // Running the interface is the evidence that it is genuinely used; a
      // failed attempt is not, so nothing is recorded on the error path.
      onRecordAction?.(LEARNING_ACTION, operationTarget(operation));
      toast.success(`${operation.id} completed against the PBX`);
    } catch (error) {
      setResult(null);
      toast.error(error.response?.data?.detail || "The PBX did not answer that interface");
    } finally {
      setRunBusy(false);
    }
  };

  if (catalogueBusy) {
    return <Card><CardContent className="flex items-center gap-3 py-14 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the PBX capability catalogue…</CardContent></Card>;
  }
  if (catalogueError) {
    return <Card className="border-amber-500/30"><CardContent className="flex flex-col items-start gap-3 py-12 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" /><div><p className="text-sm font-medium">The PBX capability catalogue could not be loaded</p><p className="mt-1 text-xs text-muted-foreground">Nexus did not reach the catalogue endpoint, so no PBX interface has been run.</p></div></div><Button variant="outline" size="sm" onClick={loadCatalogue}>Retry catalogue</Button></CardContent></Card>;
  }

  const rows = result ? resultRows(result.data) : [];
  const columns = rows.length ? Object.keys(rows[0]).slice(0, VOICE_COLUMN_LIMIT) : [];

  return <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]" data-testid="voice-capability-console">
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Capability families</CardTitle>
        <CardDescription>{catalogue?.operation_count || 0} PBX interfaces · {catalogue?.write_count || 0} change state</CardDescription>
        {hint && (rememberedFamily || rememberedOperation) && (
          <Badge
            variant="outline"
            data-testid="voice-capability-learning"
            data-learning-tone={hint.tone}
            title={hint.detail}
            className="w-fit gap-1 border-sky-500/25 bg-sky-500/[0.07] text-[10px] font-medium text-sky-200"
          >
            <Sparkles className="h-3 w-3" />{hint.label}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-1 p-2 pt-0">
        {families.map((item) => <button
          type="button"
          key={item.category}
          onClick={() => { setCategory(item.category); setOperationQuery(""); onRecordAction?.(LEARNING_VIEW, familyTarget(item.category)); }}
          data-testid={`voice-capability-family-${item.category.toLowerCase().replaceAll(" ", "-")}`}
          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${item.category === family?.category ? "bg-sky-500/10 text-sky-100" : "text-muted-foreground hover:bg-muted/60"}`}
        >
          <span className="truncate font-medium">{item.category}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{item.operations.length}</span>
        </button>)}
      </CardContent>
    </Card>

    <div className="space-y-4">
      <Card className="border-sky-500/20">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
          <div className="space-y-1.5">
            <Label>Client PBX</Label>
            <Select value={pbxId} onValueChange={onPbxChange} disabled={!pbxs.length}>
              <SelectTrigger data-testid="voice-capability-pbx"><SelectValue placeholder={pbxs.length ? "Choose a client PBX" : "No live-enabled PBXs"} /></SelectTrigger>
              <SelectContent>{pbxs.map((pbx) => <SelectItem key={pbx.id} value={pbx.id}>{pbx.client_name} · {pbx.name}</SelectItem>)}</SelectContent>
            </Select>
            {!pbxs.length && <p className="text-xs text-amber-300">A PBX needs its own OpenAPI credentials before Nexus may run any interface against it.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Find an interface</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={operationQuery} onChange={(event) => setOperationQuery(event.target.value)} className="pl-9" placeholder="Search operation or description" data-testid="voice-capability-search" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">{family?.category} interfaces</CardTitle><CardDescription>Every interface is declared in the Nexus catalogue, so only described operations can ever reach a client PBX.</CardDescription></CardHeader>
        <CardContent className="max-h-72 space-y-1 overflow-y-auto p-2 pt-0">
          {familyOperations.map((item) => <button
            type="button"
            key={item.id}
            onClick={() => selectOperation(item)}
            data-testid={`voice-capability-operation-${item.id}`}
            className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition ${item.id === operation?.id ? "border-sky-500/40 bg-sky-500/[0.07]" : "border-transparent hover:border-border/60 hover:bg-muted/40"}`}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium">{item.id}</span>
              <Badge variant="outline" className="text-[10px]">{item.method}</Badge>
              {item.access === "write" && <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-300">Changes PBX</Badge>}
              {item.destructive && <Badge variant="outline" className="border-rose-500/30 text-[10px] text-rose-300">Destructive</Badge>}
              {item.proxied && <Badge variant="outline" className="border-violet-500/30 text-[10px] text-violet-300">Artifact route</Badge>}
            </span>
            <span className="text-xs text-muted-foreground">{item.summary}</span>
          </button>)}
          {!familyOperations.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No interface in this family matches that search.</p>}
        </CardContent>
      </Card>

      {operation && <Card className="border-sky-500/25">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm"><SquareTerminal className="h-4 w-4 text-sky-300" /><span className="font-mono text-xs">{operation.id}</span></CardTitle>
              <CardDescription className="mt-1">{operation.summary}</CardDescription>
            </div>
            <Badge variant="outline" className={operation.access === "write" ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>{operation.access === "write" ? "Changes PBX state" : "Read only"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {operation.proxied ? <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.05] p-3 text-xs text-muted-foreground">
            The provider's answer to this interface authorises a download, so Nexus follows it server-side and never hands the URL to a browser. Recording and voicemail audio is played from the results below, and other artifacts are listed through their own family.
          </div> : <>
            {!!declaredParams.length && <div className="grid gap-3 sm:grid-cols-2">
              {declaredParams.map((key) => <div className="space-y-1.5" key={key}>
                <Label htmlFor={`voice-capability-param-${key}`}>{key}</Label>
                <Input id={`voice-capability-param-${key}`} value={values[key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder={`Value for ${key}`} data-testid={`voice-capability-param-${key}`} />
              </div>)}
            </div>}

            {operation.access === "write" && <div className="space-y-1.5">
              <Label htmlFor="voice-capability-body">Provider request body (JSON)</Label>
              <textarea
                id="voice-capability-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder='{"id": "101", "caller_id_name": "Reception"}'
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">Only fields the catalogue declares for this interface are forwarded, so an unexpected key cannot reach the PBX.</p>
            </div>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {operation.required_action ? <>Requires the <span className="font-mono">{operation.required_action}</span> action permission.</> : "Reading this interface needs no additional action permission."}
                {operation.access === "write" ? " Every call is written to the audit ledger." : ""}
              </p>
              <Button onClick={run} disabled={runBusy || !pbxId || operation.proxied} variant={operation.destructive ? "destructive" : "default"} data-testid="voice-capability-run">
                {runBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {runBusy ? "Running…" : operation.destructive ? "Review and run" : "Run interface"}
              </Button>
            </div>
          </>}
        </CardContent>
      </Card>}

      {result && <Card>
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="text-sm">PBX response</CardTitle><CardDescription className="font-mono text-xs">{result.operation} · {result.pbx_id}</CardDescription></div>{audio && <audio className="h-9 w-full max-w-md" controls autoPlay src={audio.url} data-testid="voice-artifact-player" />}</div></CardHeader>
        <CardContent className="p-0">
          {rows.length ? <>
            <div className="max-h-96 overflow-auto">
              <Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column} className="whitespace-nowrap text-xs">{column}</TableHead>)}<TableHead className="text-right text-xs">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{rows.slice(0, VOICE_ROW_LIMIT).map((row, index) => {
                  const artifact = artifactFor(operation?.id, row);
                  return <TableRow key={artifact?.id || index}>
                  {columns.map((column) => <TableCell key={column} className="max-w-64 truncate text-xs" title={cellValue(row[column])}>{cellValue(row[column])}</TableCell>)}
                  <TableCell className="text-right">{artifact ? <Button size="sm" variant="ghost" disabled={audioBusy === artifact.id || !pbxId} onClick={() => listen(artifact.kind, artifact.id, artifact.extensionId)} data-testid={`voice-artifact-${artifact.id}`}>{audioBusy === artifact.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}Listen</Button> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                </TableRow>;
                })}</TableBody>
              </Table>
            </div>
            <p className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">Showing {Math.min(rows.length, VOICE_ROW_LIMIT)} of {rows.length} record{rows.length === 1 ? "" : "s"} the PBX returned for this call.</p>
          </> : <div className="px-4 py-8">
            <p className="text-sm font-medium">The PBX returned no records for this request</p>
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-[11px]">{JSON.stringify(result.data ?? null, null, 2)}</pre>
          </div>}
        </CardContent>
      </Card>}
    </div>

    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open && !runBusy) setConfirmOpen(false); }}>
    <NexusWorkflowDialog
      eyebrow="Destructive PBX change"
      title={`Run the ${operation?.id} interface?`}
      description="This interface removes or replaces provider state. Nexus records the technician, the target PBX and the interface in the audit ledger, but it cannot undo the change on the appliance."
      icon={AlertTriangle}
      tone="rose"
      className="max-w-lg"
      footer={<><Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={runBusy}>Cancel</Button><Button variant="destructive" onClick={run} disabled={runBusy} data-testid="voice-capability-confirm-destructive">{runBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run {operation?.id}</Button></>}
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.05] p-3 text-xs text-muted-foreground">
          {operation?.summary}
        </div>
        {!!declaredParams.length && <div className="space-y-1 text-xs">
          <p className="font-medium">Target</p>
          {declaredParams.map((key) => <p key={key} className="font-mono text-muted-foreground">{key}: {String(values[key] ?? "").trim() || "not supplied"}</p>)}
        </div>}
        <p className="text-xs text-muted-foreground">{pbxs.find((pbx) => pbx.id === pbxId)?.client_name} · {pbxs.find((pbx) => pbx.id === pbxId)?.name}</p>
      </div>
    </NexusWorkflowDialog>
    </Dialog>
  </div>;
}
