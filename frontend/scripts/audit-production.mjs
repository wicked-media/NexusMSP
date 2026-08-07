import { spawnSync } from "node:child_process";

const allowedAdvisories = new Map([
  [
    "GHSA-qwww-vcr4-c8h2",
    {
      package: "react-router",
      expires: "2026-10-31",
      reason:
        "NexusMSP is a client-only BrowserRouter SPA and does not enable React Router RSC mode or server actions. No patched 7.x react-router-dom release exists yet.",
    },
  ],
]);

const pnpmCli = process.env.npm_execpath;
const executable = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = pnpmCli ? [pnpmCli, "audit", "--prod", "--json"] : ["audit", "--prod", "--json"];
const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: !pnpmCli && process.platform === "win32",
});

let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch (error) {
  console.error("Unable to parse pnpm audit output.");
  console.error(result.stderr || error.message);
  process.exit(2);
}

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const today = new Date().toISOString().slice(0, 10);
const blocked = [];
const accepted = [];

for (const advisory of Object.values(report.advisories || {})) {
  if ((severityRank[advisory.severity] || 0) < severityRank.high) continue;
  const exception = allowedAdvisories.get(advisory.github_advisory_id);
  if (
    exception &&
    exception.package === advisory.module_name &&
    exception.expires >= today
  ) {
    accepted.push({ advisory, exception });
  } else {
    blocked.push(advisory);
  }
}

for (const { advisory, exception } of accepted) {
  console.warn(
    `Accepted until ${exception.expires}: ${advisory.github_advisory_id} ` +
      `(${advisory.module_name}) — ${exception.reason}`,
  );
}

if (blocked.length) {
  for (const advisory of blocked) {
    console.error(
      `BLOCKED ${advisory.severity}: ${advisory.github_advisory_id || advisory.id} ` +
        `${advisory.module_name} — ${advisory.title}`,
    );
  }
  process.exit(1);
}

console.log("Production dependency audit passed (high/critical advisories)." );
