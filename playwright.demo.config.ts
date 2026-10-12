import { defineConfig } from "@playwright/test";

const PORT = 4417;

/**
 * End-to-end tests of the web demo in Chromium (`npm run build:demo` first; `npm run e2e:demo`
 * does both). The build is served under /try/, the path genbeya.fyi hosts it under.
 */
export default defineConfig({
  testDir: "e2e/demo",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-demo" }]] : "list",
  outputDir: "test-results-demo",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/try/`,
    browserName: "chromium",
    viewport: { width: 1000, height: 680 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/serve-demo.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/try/`,
    reuseExistingServer: !process.env["CI"],
  },
});
