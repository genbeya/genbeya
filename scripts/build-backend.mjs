// Bundles the shells that run the managers outside the webview:
//   node scripts/build-backend.mjs            Electron main process and preload → dist/electron
//   node scripts/build-backend.mjs deno       Deno Desktop shell → dist/deno
// The Tauri shell needs no bundle: its managers run in the client (see src/client/app/platform).
import { build } from "esbuild";

const shell = process.argv[2] ?? "electron";
const common = { bundle: true, logLevel: "warning", legalComments: "none", sourcemap: "linked" };

if (shell === "electron") {
  await build({
    ...common,
    entryPoints: { main: "src/shells/electron/main.ts", preload: "src/shells/electron/preload.ts" },
    outdir: "dist/electron",
    outExtension: { ".js": ".cjs" },
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  });
} else if (shell === "deno") {
  await build({
    ...common,
    entryPoints: { main: "src/shells/deno/main.ts" },
    outdir: "dist/deno",
    platform: "node",
    format: "esm",
    target: "esnext",
    // Bundled CommonJS packages (yaml) require Node built-ins at run time.
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
} else {
  throw new Error(`Unknown shell ${shell}; use electron or deno.`);
}
