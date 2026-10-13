import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";

import {
  CANONICAL_STATE_MODULE,
  GATED_CLASSES,
  REQUIRED_STATES,
  buildExperienceReport,
  classifyWorkspace,
  findStatePrimitiveDuplicates,
  isScannableSource,
} from "./experienceReadiness";

const SRC = join(__dirname, "..");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return isScannableSource(entry.name) ? [path] : [];
  });

const toSourcePath = (path) => `src/${relative(SRC, path).replaceAll("\\", "/")}`;

describe("experience readiness contract", () => {
  test("a workspace owes the technician loading, empty and error as distinct outcomes", () => {
    expect(REQUIRED_STATES).toEqual(["loading", "empty", "error"]);
    expect(GATED_CLASSES).toEqual(["duplicateStatePrimitives", "workspacesWithoutErrorPath"]);
  });

  test("a read with no failure path is missing its error state even when loading and empty are handled", () => {
    const classified = classifyWorkspace(`
      const [loading, setLoading] = useState(true);
      const [rows, setRows] = useState([]);
      useEffect(() => { axios.get(url).then((response) => setRows(response.data)); }, []);
      if (loading) return <Skeleton rows={3} />;
      if (!rows.length) return <EmptyState title="Nothing here yet" />;
    `);

    expect(classified.fetchesData).toBe(true);
    expect(classified.presents).toMatchObject({ loading: true, empty: true, error: false });
    expect(classified.missingStates).toEqual(["error"]);
  });

  test("a page that reads nothing is not asked for state handling", () => {
    const classified = classifyWorkspace("export default function Page() { return <div>Static</div>; }");

    expect(classified.fetchesData).toBe(false);
    expect(classified.missingStates).toEqual([]);
  });

  test("a fixture declared inside a suite is not a shipped implementation", () => {
    expect(isScannableSource("src/pages/TicketsPage.jsx")).toBe(true);
    expect(isScannableSource("src/lib/experienceReadiness.test.js")).toBe(false);
    expect(isScannableSource("src/index.css")).toBe(false);
  });

  test("a state panel outside the canonical module is reported as a duplicate", () => {
    const duplicates = findStatePrimitiveDuplicates([
      { path: CANONICAL_STATE_MODULE, source: "export function EmptyState() { return null; }" },
      {
        path: "src/pages/SomePage.jsx",
        source: "function EmptyState({ title }) { return null; }\nconst LoadingState = () => null;",
      },
      { path: "src/pages/OtherPage.jsx", source: "const rows = items.map((item) => item.id);" },
    ]);

    expect(duplicates).toEqual([
      { path: "src/pages/SomePage.jsx", names: ["EmptyState", "LoadingState"] },
    ]);
  });

  test("the report fails on duplicates or a missing error path, and ranks the worst workspace first", () => {
    const failing = buildExperienceReport({
      workspaces: [
        { path: "src/pages/A.jsx", fetchesData: true, presents: { loading: true, empty: false, error: false }, missingStates: ["empty", "error"] },
        { path: "src/pages/B.jsx", fetchesData: true, presents: { loading: false, empty: false, error: false }, missingStates: ["loading", "empty", "error"] },
        { path: "src/pages/C.jsx", fetchesData: false, presents: { loading: false, empty: false, error: false }, missingStates: [] },
      ],
      duplicates: [{ path: "src/pages/D.jsx", names: ["EmptyState"] }],
    });

    expect(failing.failed).toBe(true);
    expect(failing.workspacesFetchingData).toBe(2);
    expect(failing.workspacesWithoutErrorPath).toEqual(["src/pages/A.jsx", "src/pages/B.jsx"]);
    expect(failing.stateBacklog).toEqual([
      { path: "src/pages/B.jsx", missingStates: ["loading", "empty", "error"] },
      { path: "src/pages/A.jsx", missingStates: ["empty", "error"] },
    ]);

    const clean = buildExperienceReport({
      workspaces: [
        { path: "src/pages/A.jsx", fetchesData: true, presents: { loading: true, empty: true, error: true }, missingStates: [] },
      ],
      duplicates: [],
    });

    expect(clean.failed).toBe(false);
    expect(clean.workspacesWithoutErrorPath).toEqual([]);
  });

  test("this repository ships exactly one implementation of each state primitive", () => {
    const source = walk(SRC).map((path) => ({
      path: toSourcePath(path),
      source: readFileSync(path, "utf8"),
    }));

    expect(findStatePrimitiveDuplicates(source)).toEqual([]);

    const canonical = source.find((entry) => entry.path === CANONICAL_STATE_MODULE);
    expect(canonical).toBeDefined();
    for (const primitive of ["EmptyState", "LoadingState", "ErrorState"]) {
      expect(canonical.source).toContain(`export function ${primitive}(`);
    }
  });
});
