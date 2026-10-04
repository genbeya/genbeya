// Runs the renderer in a browser against this repository (or GITDESK_REPO),
// for design work. Open http://127.0.0.1:5173/?bridge
import { spawn } from "node:child_process";
const windows = process.platform === "win32";
const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: windows });
const children = [run("npx", ["tsx", "scripts/browser-bridge.ts"]), run("npx", ["vite"])];
const stop = () => {
  for (const child of children)
    if (windows) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
