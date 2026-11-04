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
    command: "pnpm start",
    url: browserBaseUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      BROWSER: "none",
      HOST: "127.0.0.1",
      PORT: frontendPort,
      REACT_APP_BACKEND_URL: process.env.NEXUS_ACCEPTANCE_BASE_URL || "http://127.0.0.1:18000",
    },
  },
});
