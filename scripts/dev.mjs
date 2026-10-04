import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
const windows = process.platform === "win32";
const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: windows });
// On Windows `shell` wraps the process in cmd.exe; kill the whole tree so Vite
// does not keep port 5173 (strictPort) busy for the next `npm run dev`.
const stop = (child) => {
  if (child.exitCode !== null) return;
  if (windows)
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  else child.kill();
};
const compile = run("npx", ["tsc", "-p", "tsconfig.electron.json"]);
await new Promise((resolve, reject) =>
  compile.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Compile failed")),
  ),
);
mkdirSync("dist-electron/electron", { recursive: true });
copyFileSync("electron/preload.cjs", "dist-electron/electron/preload.cjs");
const vite = run("npx", ["vite"]);
const deadline = Date.now() + 30000;
while (true) {
  try {
    await fetch("http://127.0.0.1:5173");
    break;
  } catch {
    if (Date.now() > deadline) {
      stop(vite);
      throw new Error("Vite did not start");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
process.env.GITDESK_DEV = "1";
const electron = run("npx", ["electron", "."]);
electron.on("exit", () => {
  stop(vite);
  process.exit();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop(electron);
    stop(vite);
    process.exit();
  });
