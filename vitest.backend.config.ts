import { defineConfig } from "vitest/config";

/** Managers, engines, access layer, utilities and shells; the client runs under `ng test`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/{contracts,utilities,engines,access,managers,platforms,shells}/**/*.spec.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
