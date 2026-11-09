import { defineConfig } from "@playwright/test";

const PORT = 4418;

/**
 * End-to-end tests of Genbeya on GitHub in Chromium (`npm run build:github` first; `npm run e2e:github`
 * does both). The build is served as genbeya.fyi serves it, below /github/; the tests answer for GitHub.
 */
export default defineConfig({
  testDir: "e2e/github",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-github" }]] : "list",
  outputDir: "test-results-github",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/github/`,
    browserName: "chromium",
    viewport: { width: 1000, height: 680 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/serve-github.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/github/`,
    reuseExistingServer: !process.env["CI"],
  },
});
