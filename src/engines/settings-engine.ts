/**
 * Project settings: defaults, validation and the `.gitdesk.yml` format.
 * `windows` says whether the repository lives on a Windows file system,
 * where folder names such as `GIT~1` or `tasks.` are aliases.
 */
import YAML from "yaml";
import type { Settings } from "../contracts/model";
import { validateRepositoryPath, within } from "../utilities/repository-path";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "../utilities/text-style";

export const SETTINGS_FILE = ".gitdesk.yml";
const DEFAULT_STATUSES = ["backlog", "todo", "in-progress", "review", "done"];

/** "GitDesk" → "GD", "my project" → "MP", "atlas" → "ATL". */
function prefixFor(name: string): string {
  const capitals = name.match(/[A-Z]/g) ?? [];
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const prefix =
    capitals.length >= 2 ? capitals.join("") : words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "T").slice(0, 3);
  return prefix.toUpperCase().slice(0, 6) || "T";
}

export class SettingsEngine {
  defaults(name: string): Settings {
    return {
      name,
      wikiRoot: "docs",
      wikiHome: "Home.md",
      taskRoot: "tasks",
      taskPrefix: prefixFor(name),
      statuses: [...DEFAULT_STATUSES],
    };
  }

  validate(value: Settings, windows: boolean): Settings {
    const text = (input: unknown, label: string, max: number) => {
      if (typeof input !== "string" || !input.trim() || input.length > max)
        throw new Error(`${label} is required (up to ${max} characters).`);
      return input.trim();
    };
    const folder = (input: unknown, label: string) => validateRepositoryPath(text(input, label, 200), windows);
    const name = text(value.name, "Project name", 120);
    const wikiRoot = folder(value.wikiRoot, "Wiki folder");
    const taskRoot = folder(value.taskRoot, "Task folder");
    const wikiHome = folder(value.wikiHome, "Wiki home");
    if (!wikiHome.endsWith(".md")) throw new Error("The wiki home must be a Markdown file.");
    if (wikiRoot === taskRoot || within(wikiRoot, taskRoot) || within(taskRoot, wikiRoot))
      throw new Error("Wiki and task folders must not contain each other.");
    const taskPrefix = text(value.taskPrefix, "Task prefix", 12).toUpperCase();
    if (!/^[A-Z][A-Z0-9]*$/.test(taskPrefix)) throw new Error("The task prefix uses letters and digits, starting with a letter.");
    const statuses = Array.isArray(value.statuses) ? value.statuses.map((s: unknown) => (typeof s === "string" ? s.trim() : "")) : [];
    if (
      statuses.length < 1 ||
      statuses.length > 12 ||
      new Set(statuses).size !== statuses.length ||
      statuses.some((s) => !s || s.length > 40)
    )
      throw new Error("Use 1–12 unique workflow states.");
    return { name, wikiRoot, wikiHome, taskRoot, taskPrefix, statuses };
  }

  /** Reads a settings file over `fallback`; unknown keys are ignored here and kept by {@link serialize}. */
  parse(content: string, fallback: Settings, windows: boolean): Settings {
    const document = YAML.parseDocument(withoutByteOrderMark(content));
    if (document.errors.length) throw new Error(document.errors[0]!.message);
    const data: unknown = document.toJS() ?? {};
    if (typeof data !== "object" || Array.isArray(data)) throw new Error("Settings must be a YAML mapping.");
    return this.validate({ ...fallback, ...(data as Partial<Settings>) }, windows);
  }

  /** The settings file, written over `previous` in its byte order mark and line endings. */
  serialize(settings: Settings, previous: string | null, windows: boolean): string {
    const valid = this.validate(settings, windows);
    let document = new YAML.Document({});
    if (previous !== null) {
      const parsed = YAML.parseDocument(withoutByteOrderMark(previous));
      if (!parsed.errors.length && YAML.isMap(parsed.contents)) document = parsed;
    }
    for (const [key, value] of Object.entries(valid)) document.set(key, value);
    return applyTextStyle(document.toString(), previous === null ? LF_STYLE : textStyleOf(previous));
  }
}
