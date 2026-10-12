import { defineConfig } from "@playwright/test";

/** End-to-end tests drive the built Electron app (`npm run build` first; `npm run e2e` does both). */
export default defineConfig({
  testDir: "e2e",
  // The web demo runs in a browser, with a configuration of its own (playwright.demo.config.ts).
  testIgnore: "demo/**",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
