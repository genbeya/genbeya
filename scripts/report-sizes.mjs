// Lists the packaged apps of every runtime with their sizes, as a Markdown
// table (appended to the GitHub job summary when available).
import { appendFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((sum, e) => sum + size(path.join(p, e)), 0) : statSync(p).size);
const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";
const list = (dir, test) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .map((f) => path.join(dir, String(f)))
        .filter(test)
    : [];

const INSTALLER = /\.(exe|msi|dmg|AppImage|deb|rpm)$/;
const rows = [
  ...list("release", (f) => INSTALLER.test(f) && !f.includes("unpacked") && !f.includes("__uninstaller")).map((f) => ["Electron", f]),
  ...list("desktop/tauri/src-tauri/target/release/bundle", (f) => INSTALLER.test(f)).map((f) => ["Tauri", f]),
  ...list("release-deno", (f) => path.dirname(f) === "release-deno").map((f) => ["Deno", f]),
];

const table = [
  `### Package sizes (${process.platform}-${process.arch})`,
  "",
  "| Runtime | Package | Size |",
  "| --- | --- | ---: |",
  ...rows.map(([runtime, file]) => `| ${runtime} | ${path.basename(file)} | ${mb(size(file))} |`),
  "",
].join("\n");

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
