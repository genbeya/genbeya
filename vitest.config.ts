import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/ui.test.tsx", "tests/renderer.test.ts"],
    pool: "threads",
    maxWorkers: 1,
    testTimeout: 60000,
  },
});
