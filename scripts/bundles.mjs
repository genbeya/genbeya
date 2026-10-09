// esbuild options of the shells that run the managers outside the webview,
// shared by the build (build-backend.mjs) and the dev loop (dev.mjs).
// The Tauri shell needs no bundle: its managers run in the client (see src/client/app/platform).
const common = { bundle: true, logLevel: "warning", legalComments: "none", sourcemap: "linked" };

/** Electron main process and preload → dist/electron */
export const electronBundle = {
  ...common,
  entryPoints: { main: "src/shells/electron/main.ts", preload: "src/shells/electron/preload.ts" },
  outdir: "dist/electron",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
};

/** Deno Desktop shell → dist/deno */
export const denoBundle = {
  ...common,
  entryPoints: { main: "src/shells/deno/main.ts" },
  outdir: "dist/deno",
  platform: "node",
  format: "esm",
  target: "esnext",
  // Bundled CommonJS packages (yaml) require Node built-ins at run time.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
};
