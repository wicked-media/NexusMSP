const { defineConfig } = require("@playwright/test");

const browserBaseUrl = process.env.NEXUS_BROWSER_BASE_URL || "http://127.0.0.1:13000";
const frontendPort = new URL(browserBaseUrl).port || "13000";

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "../test_reports/browser-acceptance/results",
  reporter: [
    ["list"],
    ["json", { outputFile: "../test_reports/browser-acceptance/results.json" }],
    ["html", { outputFolder: "../test_reports/browser-acceptance/html", open: "never" }],
  ],
  use: {
    baseURL: browserBaseUrl,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // Build and serve the production artifact. The CRA development shell
    // compiles lazy route chunks on demand, which can leave a fresh browser
    // context without the login form and turn a UI readiness race into a false
    // authentication failure. This gate must exercise what ships.
    command: "pnpm build && node scripts/serve-build.js",
    url: browserBaseUrl,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOST: "127.0.0.1",
      PORT: frontendPort,
      REACT_APP_BACKEND_URL: process.env.NEXUS_ACCEPTANCE_BASE_URL || "http://127.0.0.1:18000",
    },
  },
});
