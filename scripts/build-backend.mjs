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
  });
} else {
  throw new Error(`Unknown shell ${shell}; use electron or deno.`);
}
