import YAML from "yaml";
import type { Settings } from "../shared/api.js";
import { relativePath, within } from "./paths.js";

export const SETTINGS_FILE = ".gitdesk.yml";

export function defaultSettings(name: string): Settings {
  return {
    name,
    wikiRoot: "docs",
    wikiHome: "Home.md",
    taskRoot: "tasks",
    taskPrefix: prefixFor(name),
    statuses: ["backlog", "todo", "in-progress", "review", "done"],
  };
}

/** "GitDesk" -> "GD", "my project" -> "MP", "atlas" -> "ATL". */
export function prefixFor(name: string) {
  const capitals = name.match(/[A-Z]/g) ?? [];
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const prefix =
    capitals.length >= 2
      ? capitals.join("")
      : words.length >= 2
        ? words.map((w) => w[0]).join("")
        : (words[0] ?? "T").slice(0, 3);
  return prefix.toUpperCase().slice(0, 6) || "T";
}

export function validateSettings(value: Settings): Settings {
  const text = (v: unknown, label: string, max: number) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      throw new Error(`${label} is required (up to ${max} characters).`);
    return v.trim();
  };
  const name = text(value.name, "Project name", 120);
  const wikiRoot = relativePath(text(value.wikiRoot, "Wiki folder", 200), false);
  const taskRoot = relativePath(text(value.taskRoot, "Task folder", 200), false);
  const wikiHome = relativePath(text(value.wikiHome, "Wiki home", 200), false);
  if (!wikiHome.endsWith(".md")) throw new Error("The wiki home must be a Markdown file.");
  if (wikiRoot === taskRoot || within(wikiRoot, taskRoot) || within(taskRoot, wikiRoot))
    throw new Error("Wiki and task folders must not contain each other.");
  const taskPrefix = text(value.taskPrefix, "Task prefix", 12).toUpperCase();
  if (!/^[A-Z][A-Z0-9]*$/.test(taskPrefix))
    throw new Error("The task prefix uses letters and digits, starting with a letter.");
  const statuses = Array.isArray(value.statuses)
    ? value.statuses.map((s) => (typeof s === "string" ? s.trim() : ""))
    : [];
  if (
    statuses.length < 1 ||
    statuses.length > 12 ||
    new Set(statuses).size !== statuses.length ||
    statuses.some((s) => !s || s.length > 40)
  )
    throw new Error("Use 1–12 unique workflow states.");
  return { name, wikiRoot, wikiHome, taskRoot, taskPrefix, statuses };
}

/** Parses settings; unknown keys are ignored here and preserved by {@link serializeSettings}. */
export function parseSettings(content: string, fallback: Settings): Settings {
  const document = YAML.parseDocument(content);
  if (document.errors.length) throw new Error(document.errors[0].message);
  const data = document.toJS() ?? {};
  if (typeof data !== "object" || Array.isArray(data))
    throw new Error("Settings must be a YAML mapping.");
  return validateSettings({ ...fallback, ...data });
}

export function serializeSettings(settings: Settings, previous: string | null) {
  let document = new YAML.Document({});
  if (previous !== null) {
    const parsed = YAML.parseDocument(previous);
    if (!parsed.errors.length && YAML.isMap(parsed.contents)) document = parsed;
  }
  for (const [key, value] of Object.entries(validateSettings(settings)))
    document.set(key, value);
  return document.toString();
}
