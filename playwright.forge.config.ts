import { defineConfig } from "@playwright/test";

const PORT = 4418;

/**
 * End-to-end tests of Genbeya on forges in Chromium (`npm run build:forge` first; `npm run e2e:forge`
 * does both). The build is served as genbeya.fyi will serve it (`scripts/serve-forge.mjs`), with a content
 * security policy per address; the tests answer for the forges.
 */
export default defineConfig({
  testDir: "e2e/forge",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-forge" }]] : "list",
  outputDir: "test-results-forge",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    browserName: "chromium",
    viewport: { width: 1000, height: 680 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/serve-forge.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env["CI"],
  },
});
