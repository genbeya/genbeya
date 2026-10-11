/**
 * Rules for .gitignore files: what line ignores a file, a folder or every
 * file with an extension, written so Git reads the name literally, and
 * appending that line in the file's own style.
 */
import type { IgnoreKind } from "../contracts/model";
import { baseName, parentOf } from "./repository-path";

/** Escapes what gitignore patterns treat specially: wildcards, brackets, backslashes and trailing spaces. */
export function escapeIgnorePattern(name: string): string {
  const escaped = name.replace(/[\\*?[]/g, "\\$&");
  const trailing = escaped.length - escaped.replace(/ +$/, "").length;
  return escaped.slice(0, escaped.length - trailing) + "\\ ".repeat(trailing);
}

/** The extension of a file name ("ts" of "app.spec.ts"); null when it has none, as for ".env". */
export function extensionOf(path: string): string | null {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : null;
}

/**
 * The folders whose .gitignore can hold a rule for `path` (a file, or a
 * folder for {@link IgnoreKind} "folder"): the repository root ("") and the
 * folder that holds it.
 */
export function ignoreLocations(path: string): string[] {
  const parent = parentOf(path);
  return parent ? ["", parent] : [""];
}

/**
 * The line of `<location>/.gitignore` that ignores `path`: the file or
 * folder itself, anchored to the location with a leading slash, or every
 * file with its extension below the location. Null for an extension rule of
 * a file without one, or a location that does not hold `path`.
 */
export function ignoreRule(kind: IgnoreKind, path: string, location: string): string | null {
  if (location && !path.startsWith(`${location}/`)) return null;
  const relative = location ? path.slice(location.length + 1) : path;
  if (kind === "extension") {
    const extension = extensionOf(path);
    return extension === null ? null : `*.${escapeIgnorePattern(extension)}`;
  }
  return `/${relative.split("/").map(escapeIgnorePattern).join("/")}${kind === "folder" ? "/" : ""}`;
}

/** The .gitignore of a location. */
export const ignoreFile = (location: string): string => (location ? `${location}/.gitignore` : ".gitignore");

/**
 * `content` with `rule` appended as a line of its own, in the file's line
 * endings and ending with one; null when the file has the rule already.
 */
export function appendIgnoreRule(content: string, rule: string): string | null {
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.includes(rule)) return null;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content && !content.endsWith("\n") ? newline : "";
  return `${content}${separator}${rule}${newline}`;
}
