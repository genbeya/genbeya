// node scripts/collect-installers.mjs [outDir] [--dry-run]: copies the installers that
// the Electron, Tauri and Deno Desktop packaging left behind into one flat folder
// (default out/installers), renamed to Genbeya-<version>-<variant>-<os>-<arch>[-setup].<ext>,
// so the three variants never clash in a release.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const INSTALLER = /\.(exe|msi|dmg|AppImage|deb|rpm)$/;
const OS_OF_EXTENSION = { exe: "windows", msi: "windows", dmg: "macos", AppImage: "linux", deb: "linux", rpm: "linux" };

/** Where each runtime's packaging writes its installers, and how deep they sit. */
export const SOURCES = [
  { variant: "electron", dir: "release", depth: 1, skip: (name) => name.startsWith("__uninstaller") },
  // bundle/<format>/<file>; deeper files are inside .app and .AppDir folders.
  { variant: "tauri", dir: "src/shells/tauri/src-tauri/target/release/bundle", depth: 2 },
  { variant: "deno", dir: "release-deno", depth: 1 },
];

/** Normalised CPU architecture named in a file name, or the fallback (the machine's). */
export function archOf(fileName, fallback = process.arch) {
  const name = fileName.toLowerCase();
  if (/aarch64|arm64/.test(name)) return "arm64";
  if (/x86_64|amd64|x64/.test(name)) return "x64";
  if (/universal/.test(name)) return "universal";
  if (fallback === "x64" || fallback === "arm64") return fallback;
  throw new Error(`Cannot tell the architecture of ${fileName}.`);
}

/** Release file name of one installer. */
export function releaseName(fileName, variant, version, fallbackArch) {
  const ext = path.extname(fileName).slice(1);
  const os = OS_OF_EXTENSION[ext];
  if (!os) throw new Error(`${fileName} is not an installer.`);
  return `Genbeya-${version}-${variant}-${os}-${archOf(fileName, fallbackArch)}${ext === "exe" ? "-setup" : ""}.${ext}`;
}

function filesIn(dir, depth) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return depth > 1 ? filesIn(file, depth - 1) : [];
    return entry.isFile() ? [file] : [];
  });
}

/** Installers found in the build outputs, with their release names. */
export function findInstallers(version, root = ".") {
  const found = [];
  for (const { variant, dir, depth, skip } of SOURCES) {
    for (const file of filesIn(path.join(root, dir), depth)) {
      const name = path.basename(file);
      if (!INSTALLER.test(name) || skip?.(name)) continue;
      const builtFor = name.match(/\d+\.\d+\.\d+/)?.[0];
      if (builtFor && builtFor !== version) {
        console.warn(`Skipping ${file}: built for version ${builtFor}, not ${version}.`);
        continue;
      }
      found.push({ variant, file, name: releaseName(name, variant, version) });
    }
  }
  const seen = new Map();
  for (const { file, name } of found) {
    if (seen.has(name)) throw new Error(`${seen.get(name)} and ${file} would both be released as ${name}.`);
    seen.set(name, file);
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const outDir = args.find((arg) => !arg.startsWith("--")) ?? "out/installers";
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));

  const installers = findInstallers(version);
  if (installers.length === 0) throw new Error("No installers found; package first.");
  if (!dryRun) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  for (const { file, name } of installers) {
    if (!dryRun) copyFileSync(file, path.join(outDir, name));
    const mb = (statSync(file).size / 1048576).toFixed(1);
    console.log(`${name}  <-  ${file} (${mb} MB)`);
  }
}
