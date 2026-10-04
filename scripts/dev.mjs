import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
const run = (cmd, args) =>
  spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
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
      vite.kill();
      throw new Error("Vite did not start");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
process.env.GITDESK_DEV = "1";
const electron = run("npx", ["electron", "."]);
electron.on("exit", () => {
  vite.kill();
  process.exit();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    electron.kill();
    vite.kill();
    process.exit();
  });
