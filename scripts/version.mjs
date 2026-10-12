// Genbeya's version, kept the same in every file that holds it.
//   node scripts/version.mjs                     prints the version
//   node scripts/version.mjs bump <major|minor|patch>
//   node scripts/version.mjs set <major.minor.patch>
//   node scripts/version.mjs check               fails when the files disagree (CI runs it)
// A push to main publishes a release when its version has none yet; bump the version to release.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// Each file is edited in place, so nothing but the version changes in it.
const TOP_LEVEL = /^( {2}"version": ")([^"]*)(")/m;

/** Every file with the version: package.json and its lockfile, and the Tauri shell's config and crate. */
const FILES = [
  versionIn("package.json", TOP_LEVEL),
  versionIn("package-lock.json", TOP_LEVEL, /^( {4}"": \{\n(?: {6}[^\n]*\n)*? {6}"version": ")([^"]*)(")/m),
  versionIn("src/shells/tauri/src-tauri/tauri.conf.json", TOP_LEVEL),
  versionIn("src/shells/tauri/src-tauri/Cargo.toml", /^(\[package\][^[]*?^version = ")([^"]*)(")/ms),
  versionIn("src/shells/tauri/src-tauri/Cargo.lock", /^(name = "genbeya"\nversion = ")([^"]*)(")/m),
];

/** The version strings `patterns` find in `file`; each pattern captures the text around the version. */
function versionIn(file, ...patterns) {
  // Line endings are LF in the repository (.gitattributes).
  const load = () => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return {
    file,
    read() {
      const content = load();
      return patterns.map((pattern) => {
        const found = pattern.exec(content);
        if (!found) throw new Error(`No version found in ${file}.`);
        return found[2];
      });
    },
    write(version) {
      writeFileSync(
        file,
        patterns.reduce((content, pattern) => content.replace(pattern, `$1${version}$3`), load()),
      );
    },
  };
}

/** major.minor.patch as numbers. Windows installers allow at most 255.255.65535. */
export function parse(version) {
  const match = SEMVER.exec(version ?? "");
  if (!match) throw new Error(`Invalid version ${version}; expected major.minor.patch, such as 1.2.3.`);
  const parts = match.slice(1).map(Number);
  if (parts[0] > 255 || parts[1] > 255 || parts[2] > 65535) throw new Error(`${version} is too high for Windows installers.`);
  return parts;
}

/** The next version: `bump("0.4.2", "minor")` is `0.5.0`. */
export function bump(version, part) {
  const [major, minor, patch] = parse(version);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  if (part === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown part ${part}; use major, minor or patch.`);
}

function current() {
  return FILES[0].read()[0];
}

function set(version) {
  parse(version);
  for (const file of FILES) file.write(version);
  console.log(version);
}

function check() {
  const version = current();
  parse(version);
  const wrong = FILES.flatMap(({ file, read }) =>
    read()
      .filter((found) => found !== version)
      .map((found) => `${file} has ${found}`),
  );
  if (wrong.length) {
    throw new Error(`package.json has ${version}, but ${wrong.join(", ")}. Run "node scripts/version.mjs set ${version}".`);
  }
  console.log(version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, value] = process.argv.slice(2);
  if (!command) console.log(current());
  else if (command === "bump") set(bump(current(), value));
  else if (command === "set") set(value);
  else if (command === "check") check();
  else throw new Error(`Unknown command ${command}; use bump, set or check.`);
}
