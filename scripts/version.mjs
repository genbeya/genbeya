// node scripts/version.mjs stamp <build>: sets the patch number of every version
// GitDesk ships with to <build> (CI passes its run number), so each release has a
// higher version than the one before and installers upgrade the installed app.
// package.json holds the major and minor version; raise the minor version for a
// release with new features. `node scripts/version.mjs` prints the current version.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Files holding the app's version: package.json for Electron and the client, tauri.conf.json for Tauri. */
const FILES = ["package.json", "src/shells/tauri/src-tauri/tauri.conf.json"];

/** `0.3.0` with build 42 → `0.3.42`. MSI versions allow at most 65535 as the third number. */
export function releaseVersion(version, build) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!match) throw new Error(`Unexpected version ${version}; expected major.minor.patch.`);
  if (!/^\d+$/.test(String(build)) || Number(build) > 65535) throw new Error(`Invalid build number ${build}.`);
  return `${match[1]}.${match[2]}.${Number(build)}`;
}

function stamp(build) {
  const version = releaseVersion(JSON.parse(readFileSync(FILES[0], "utf8")).version, build);
  for (const file of FILES) {
    const text = readFileSync(file, "utf8");
    const next = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
    if (next === text && !text.includes(`"version": "${version}"`)) throw new Error(`No version found in ${file}.`);
    writeFileSync(file, next);
  }
  console.log(version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, build] = process.argv.slice(2);
  if (command === "stamp") stamp(build);
  else if (!command) console.log(JSON.parse(readFileSync(FILES[0], "utf8")).version);
  else throw new Error(`Unknown command ${command}; use "stamp <build>".`);
}
