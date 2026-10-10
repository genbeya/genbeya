// node scripts/report-sizes.mjs [dir]: lists the installers collected by
// collect-installers.mjs (default out/installers) with their sizes, as a Markdown
// table (appended to the GitHub job summary when available).
import { appendFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const VARIANTS = { electron: "Electron", tauri: "Tauri", deno: "Deno Desktop" };
const dir = process.argv[2] ?? "out/installers";
const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";

const rows = readdirSync(dir)
  .map((name) => ({
    name,
    variant: name.match(/-(electron|tauri|deno)-(windows|macos|linux)-/)?.[1],
    size: statSync(path.join(dir, name)).size,
  }))
  .filter((row) => row.variant)
  .sort((a, b) => Object.keys(VARIANTS).indexOf(a.variant) - Object.keys(VARIANTS).indexOf(b.variant) || a.name.localeCompare(b.name));

const table = [
  `### Installer sizes (${process.platform}-${process.arch})`,
  "",
  "| Runtime | Installer | Size |",
  "| --- | --- | ---: |",
  ...rows.map((row) => `| ${VARIANTS[row.variant]} | ${row.name} | ${mb(row.size)} |`),
  "",
].join("\n");

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
