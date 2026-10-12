// node scripts/package-deno.mjs [format...]: packages the Deno Desktop shell as
// installers in release-deno/. `deno desktop` picks the format from the output's
// extension. Without arguments it builds the formats of the current OS
// (Windows: msi; macOS: dmg; Linux: AppImage and deb). Expects the client in
// dist/client/browser (`ng build`).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { denoBundle } from "./bundles.mjs";

const OUT = "release-deno";
const DEFAULT_FORMATS = { win32: ["msi"], darwin: ["dmg"], linux: ["AppImage", "deb"] };
const ICONS = { win32: "src/shells/tauri/src-tauri/icons/icon.ico", darwin: "src/shells/tauri/src-tauri/icons/icon.icns" };
// The output's base name becomes the product name, install folder and shortcut, so it
// differs from the Electron app's "Genbeya" (and matches the shell's settings folder).
// Debian package names allow no spaces or capitals.
const name = (format) => (format === "deb" || format === "AppImage" ? "genbeya-deno" : "Genbeya Deno");

const formats = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_FORMATS[process.platform];
if (!formats) throw new Error(`No Deno Desktop installer formats for ${process.platform}; pass them as arguments.`);

await build(denoBundle);
// Installers take their version from the configuration file; without it every MSI is 1.0.0.
const config = "dist/deno/deno.json";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(config, JSON.stringify({ version }));

// The deno npm package's launcher runs the binary for this platform.
const deno = createRequire(import.meta.url).resolve("deno/bin.cjs");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const format of formats) {
  const output = `${OUT}/${name(format)}.${format}`;
  console.log(`Packaging ${output}`);
  if (format === "dmg") {
    dmg(output);
    continue;
  }
  check(spawnSync(process.execPath, [deno, ...desktopArgs(output)], { stdio: "inherit" }));
  if (format === "msi") upgradeOlderVersions(output);
}

/** `deno desktop` arguments that build the app into `output`, in the format its extension names. */
function desktopArgs(output) {
  const icon = ICONS[process.platform] ? ["--icon", ICONS[process.platform]] : [];
  return [
    "desktop",
    "-A",
    "--no-check",
    "--config",
    config,
    ...icon,
    "--include",
    "dist/client/browser",
    "-o",
    output,
    "dist/deno/main.js",
  ];
}

/**
 * Builds the .app with `deno desktop` and the disk image with hdiutil, which sizes the image
 * after its contents: deno desktop's own DMGs fail with "No space left on device" once the app
 * grows past the size it reserves. The image also links /Applications for drag-and-drop installs.
 */
function dmg(output) {
  const stage = `${OUT}/dmg`;
  mkdirSync(stage, { recursive: true });
  check(spawnSync(process.execPath, [deno, ...desktopArgs(`${stage}/${name("dmg")}.app`)], { stdio: "inherit" }));
  symlinkSync("/Applications", `${stage}/Applications`);
  const volume = ["-volname", name("dmg"), "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", output];
  check(spawnSync("hdiutil", ["create", ...volume], { stdio: "inherit" }));
  rmSync(stage, { recursive: true, force: true });
}

/** Stops the build when a step failed. */
function check({ status, error }) {
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

/** Lets the MSI replace an installed older version instead of installing next to it. */
function upgradeOlderVersions(msi) {
  const script = "scripts/msi-major-upgrade.ps1";
  check(spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, msi], { stdio: "inherit" }));
}
