// node scripts/package-deno.mjs [format...]: packages the Deno Desktop shell as
// installers in release-deno/. `deno desktop` picks the format from the output's
// extension. Without arguments it builds the formats of the current OS
// (Windows: msi; macOS: dmg; Linux: AppImage and deb). Expects the client in
// dist/client/browser (`ng build`).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { denoBundle } from "./bundles.mjs";

const OUT = "release-deno";
const DEFAULT_FORMATS = { win32: ["msi"], darwin: ["dmg"], linux: ["AppImage", "deb"] };
const ICONS = { win32: "src/shells/tauri/src-tauri/icons/icon.ico", darwin: "src/shells/tauri/src-tauri/icons/icon.icns" };
// The output's base name becomes the product name, install folder and shortcut, so it
// differs from the Electron app's "GitDesk" (and matches the shell's settings folder).
// Debian package names allow no spaces or capitals.
const name = (format) => (format === "deb" || format === "AppImage" ? "gitdesk-deno" : "GitDesk Deno");

const formats = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_FORMATS[process.platform];
if (!formats) throw new Error(`No Deno Desktop installer formats for ${process.platform}; pass them as arguments.`);

await build(denoBundle);

// The deno npm package's launcher runs the binary for this platform.
const deno = createRequire(import.meta.url).resolve("deno/bin.cjs");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const format of formats) {
  const output = `${OUT}/${name(format)}.${format}`;
  const icon = ICONS[process.platform] ? ["--icon", ICONS[process.platform]] : [];
  const args = [
    "desktop",
    "-A",
    "--no-check",
    "--no-config",
    // Settings the runtime needs before any code runs (the WebView2 profile folder on Windows).
    "--env-file=src/shells/deno/desktop.env",
    ...icon,
    "--include",
    "dist/client/browser",
    "-o",
    output,
    "dist/deno/main.js",
  ];
  console.log(`Packaging ${output}`);
  const { status, error } = spawnSync(process.execPath, [deno, ...args], { stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}
