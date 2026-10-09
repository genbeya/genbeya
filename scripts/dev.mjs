// npm start: the Angular dev server, the Electron main process (rebuilt on change), and Electron itself.
import { spawn } from "node:child_process";
import { context } from "esbuild";
import { electronBundle } from "./bundles.mjs";

const ORIGIN = "http://127.0.0.1:5173";
const children = [];
let stopping = false;
const quit = () => {
  stopping = true;
  for (const child of children) child.kill();
  process.exit(0);
};

const backend = await context(electronBundle);
await backend.rebuild();
await backend.watch();

const serve = spawn(process.execPath, ["node_modules/@angular/cli/bin/ng.js", "serve"], { stdio: ["ignore", "pipe", "inherit"] });
children.push(serve);
serve.stdout.pipe(process.stdout);

// Electron starts once the dev server answers with GitDesk; another app on the port must not get the bridge.
serve.on("exit", (code) => {
  if (stopping) return;
  console.error(`ng serve exited (${code}); is port ${new URL(ORIGIN).port} in use?`);
  quit();
});
for (;;) {
  try {
    const response = await fetch(ORIGIN);
    if (response.ok && (await response.text()).includes("<gd-root")) break;
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
