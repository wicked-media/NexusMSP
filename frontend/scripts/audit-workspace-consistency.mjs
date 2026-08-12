import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
};

const files = (await walk(root)).filter((path) => /\.(js|jsx)$/.test(path));
const source = await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")]));
const countFiles = (needle) => source.filter(([, text]) => text.includes(needle)).length;
const directDialogs = source.filter(([, text]) => text.includes("<DialogContent")).map(([path]) => `src/${relative(root, path).replaceAll("\\", "/")}`);

console.log(JSON.stringify({
  scannedFiles: files.length,
  operationalHeaders: countFiles("OperationalPageHeader"),
  sharedWorkflowDialogs: countFiles("NexusWorkflowDialog"),
  directDialogFiles: directDialogs.length,
  directDialogFileCount: directDialogs.length,
  directDialogFiles: directDialogs,
  expectation: "New workflows must use NexusWorkflowDialog unless a documented specialist canvas is required.",
}, null, 2));
