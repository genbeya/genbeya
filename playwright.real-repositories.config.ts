import { defineConfig } from "@playwright/test";

const PORT = 4418;
const ISOLATED_PORT = 4419;

/**
 * The web demo's experiment with real repositories (wiki: Architecture/Demo-real-repositories),
 * measured in Chromium and Firefox: clones over the network, from wasm-git's playground and through
 * the local CORS relay (`scripts/cors-relay.mjs`). Not part of `npm run e2e:demo`; run
 * `npm run build:demo`, then `npx playwright test --config playwright.real-repositories.config.ts`.
 */
export default defineConfig({
  testDir: "e2e/demo-real-repositories",
  timeout: 300_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "test-results-real-repositories",
  use: { viewport: { width: 1000, height: 680 }, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        baseURL: `http://127.0.0.1:${PORT}/try/`,
        launchOptions: { args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] },
      },
    },
    {
      name: "chromium-isolated",
      use: {
        browserName: "chromium",
        baseURL: `http://127.0.0.1:${ISOLATED_PORT}/try/`,
        launchOptions: { args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] },
      },
    },
    { name: "firefox", use: { browserName: "firefox", baseURL: `http://127.0.0.1:${PORT}/try/` } },
  ],
  webServer: [
    { command: `node scripts/serve-demo.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/try/`, reuseExistingServer: true },
    {
      command: `node scripts/serve-demo.mjs ${ISOLATED_PORT} --isolated`,
      url: `http://127.0.0.1:${ISOLATED_PORT}/try/`,
      reuseExistingServer: true,
    },
    { command: "node scripts/cors-relay.mjs 8787", port: 8787, reuseExistingServer: true },
  ],
});
