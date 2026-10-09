// npm start: the Angular dev server, the Electron main process (rebuilt on change), and Electron itself.
import { spawn } from "node:child_process";
import { context } from "esbuild";

const ORIGIN = "http://127.0.0.1:5173";
const children = [];
const quit = () => {
  for (const child of children) child.kill();
  process.exit(0);
};

const backend = await context({
  entryPoints: { main: "src/shells/electron/main.ts", preload: "src/shells/electron/preload.ts" },
  outdir: "dist/electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: "linked",
  logLevel: "warning",
});
await backend.rebuild();
await backend.watch();

const serve = spawn(process.execPath, ["node_modules/@angular/cli/bin/ng.js", "serve"], { stdio: ["ignore", "pipe", "inherit"] });
children.push(serve);
serve.stdout.pipe(process.stdout);

// Electron starts once the dev server answers.
for (;;) {
  try {
    if ((await fetch(ORIGIN)).ok) break;
  } catch {
    // Not up yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const electron = spawn(process.execPath, ["node_modules/electron/cli.js", "."], {
  stdio: "inherit",
  env: { ...process.env, GITDESK_DEV_SERVER: ORIGIN },
});
children.push(electron);
electron.on("exit", quit);
process.on("SIGINT", quit);
