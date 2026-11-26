import { defineConfig } from "@playwright/test";

const PORT = 4418;

/**
 * End-to-end tests of the kit in Chromium (`npm run build:kit` first; `npm run e2e:kit` does
 * both): the built kit served as a host would, with a test host in the page.
 */
export default defineConfig({
  testDir: "e2e/kit",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-kit" }]] : "list",
  outputDir: "test-results-kit",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/kit/`,
    browserName: "chromium",
    viewport: { width: 420, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/serve-demo.mjs ${PORT} dist/kit /kit/ kit.html`,
    url: `http://127.0.0.1:${PORT}/kit/`,
    reuseExistingServer: !process.env["CI"],
  },
});
