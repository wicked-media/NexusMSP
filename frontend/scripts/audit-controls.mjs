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

const toSourcePath = (path) => `src/${relative(root, path).replaceAll("\\", "/")}`;
const files = (await walk(root)).filter((path) => /\.(js|jsx)$/.test(path));
const source = await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")]));
const testIdOwners = new Map();
const nativeButtonFiles = [];
const directColorButtons = [];

for (const [path, text] of source) {
  const sourcePath = toSourcePath(path);
  const ids = [...text.matchAll(/data-testid=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const id of ids) testIdOwners.set(id, [...(testIdOwners.get(id) || []), sourcePath]);

  const nativeButtons = (text.match(/<button\b/g) || []).length;
  if (nativeButtons) nativeButtonFiles.push({ file: sourcePath, count: nativeButtons });

  const directButtonColors = (text.match(/<(?:Button|button)\b[^>]*className=["'][^"']*(?:bg-(?:sky|cyan|emerald|violet|amber|rose|red)-|hover:bg-(?:sky|cyan|emerald|violet|amber|rose|red)-)/g) || []).length;
  if (directButtonColors) directColorButtons.push({ file: sourcePath, count: directButtonColors });
}

const duplicateTestIds = [...testIdOwners.entries()]
  .filter(([, owners]) => new Set(owners).size > 1)
  .map(([testId, owners]) => ({ testId, files: [...new Set(owners)] }));

console.log(JSON.stringify({
  scannedFiles: files.length,
  duplicateTestIds,
  duplicateTestIdCount: duplicateTestIds.length,
  nativeButtonFiles: nativeButtonFiles.sort((a, b) => b.count - a.count),
  nativeButtonCount: nativeButtonFiles.reduce((total, item) => total + item.count, 0),
  directColorButtonFiles: directColorButtons.sort((a, b) => b.count - a.count),
  directColorButtonCount: directColorButtons.reduce((total, item) => total + item.count, 0),
  expectation: "Use the shared Button component for workflow actions. Native buttons are reserved for compact navigation, selectable cards and purpose-built controls.",
}, null, 2));
